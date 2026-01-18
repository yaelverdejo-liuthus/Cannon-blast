import React, { useState, useEffect, useRef, useCallback } from 'react';
import Matter from 'matter-js';
import { Play, RotateCcw, Menu, Star, Volume2, Infinity, Trophy, ShieldAlert, Zap, Smartphone, Maximize } from 'lucide-react';

// --- CONSTANTES Y CONFIGURACIÓN ---

const COLORS = {
  woodLight: '#d69e2e',
  woodDark: '#8b4513',
  metal: '#4a5568',
  metalDark: '#2d3748',
  grass: '#48bb78',
  skyTop: '#63b3ed',
  skyBottom: '#bee3f8'
};

const LEVELS = [
  { 
    id: 1, 
    ammo: 7, 
    name: "La Pirámide", 
    type: "pyramid", 
    starsThreshold: [3000, 6000, 8200] 
  },
  { 
    id: 2, 
    ammo: 6, 
    name: "Torre de Babel", 
    type: "tower", 
    starsThreshold: [2000, 3500, 5000] 
  },
  { 
    id: 3, 
    ammo: 5, 
    name: "El Búnker", 
    type: "fort", 
    starsThreshold: [2000, 2900, 3600] 
  }
];

// --- GENERADOR DE SONIDOS (Web Audio API) ---
const playSound = (type) => {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.connect(gain);
    gain.connect(ctx.destination);

    const now = ctx.currentTime;

    if (type === 'shoot') {
      osc.type = 'square';
      osc.frequency.setValueAtTime(150, now);
      osc.frequency.exponentialRampToValueAtTime(40, now + 0.3);
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
      osc.start(now);
      osc.stop(now + 0.3);
    } else if (type === 'hit') {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(100, now);
      osc.frequency.linearRampToValueAtTime(50, now + 0.1);
      gain.gain.setValueAtTime(0.1, now);
      gain.gain.linearRampToValueAtTime(0.01, now + 0.1);
      osc.start(now);
      osc.stop(now + 0.1);
    } else if (type === 'break') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(200, now);
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
      osc.start(now);
      osc.stop(now + 0.2);
    } else if (type === 'win') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(400, now);
      osc.frequency.linearRampToValueAtTime(600, now + 0.1);
      osc.frequency.linearRampToValueAtTime(1000, now + 0.3);
      gain.gain.setValueAtTime(0.1, now);
      gain.gain.linearRampToValueAtTime(0, now + 0.6);
      osc.start(now);
      osc.stop(now + 0.6);
    }
  } catch (e) {
    // Fallback silencioso
  }
};

export default function CannonBlastGame() {
  // --- ESTADO DE REACT ---
  const [gameState, setGameState] = useState('menu'); // menu, playing, levelSelect, won, lost, roundWon
  const [currentLevelId, setCurrentLevelId] = useState(1);
  const [gameMode, setGameMode] = useState('campaign'); // 'campaign' | 'infinite'
  const [isLandscape, setIsLandscape] = useState(true); 
  
  const [score, setScore] = useState(0);
  const [ammo, setAmmo] = useState(0);
  const [bonusScore, setBonusScore] = useState(0);
  
  // Estados Modo Infinito
  const [round, setRound] = useState(1);
  const [highScore, setHighScore] = useState(() => parseInt(localStorage.getItem('cannonBlastHS') || '0'));
  
  // --- REFS ---
  const canvasRef = useRef(null);
  const engineRef = useRef(null);
  const renderReqRef = useRef(null);
  
  const gameOverTimeoutRef = useRef(null);
  
  // --- CONTROL DE PANTALLA Y ORIENTACIÓN ---
  
  const enterGameMode = () => {
    const elem = document.documentElement;
    if (elem.requestFullscreen) {
      elem.requestFullscreen().catch(err => console.log("Fullscreen blocked:", err));
    }
    if (screen.orientation && screen.orientation.lock) {
      screen.orientation.lock('landscape').catch(err => console.log("Orientation lock failed/unsupported:", err));
    }
  };

  useEffect(() => {
    const checkOrientation = () => {
      const isLand = window.innerWidth > window.innerHeight;
      setIsLandscape(isLand);
      
      const canvas = canvasRef.current;
      if (canvas) {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        // Nota: No actualizamos width/height de 'game.current' aquí para no romper físicas en caliente.
        // El resize ideal recargaría el nivel, pero para simplicidad visual solo ajustamos canvas.
      }
    };
    
    checkOrientation();
    window.addEventListener('resize', checkOrientation);
    window.addEventListener('orientationchange', checkOrientation);
    return () => {
      window.removeEventListener('resize', checkOrientation);
      window.removeEventListener('orientationchange', checkOrientation);
    };
  }, []);

  useEffect(() => {
    if (gameState !== 'playing' && gameOverTimeoutRef.current) {
        clearTimeout(gameOverTimeoutRef.current);
        gameOverTimeoutRef.current = null;
    }
  }, [gameState]);
  
  // Estado mutable del juego
  const game = useRef({
    width: 0,
    height: 0,
    viewScale: 1, // Nuevo: Factor de escala para zoom
    isDragging: false,
    dragStart: { x: 0, y: 0 },
    cannonAngle: 0,
    power: 0,
    particles: [],
    bodiesToRemove: [],
    targetsCount: 0,
    currentAmmoRef: 0 
  });

  // --- GENERADOR PROCEDURAL MEJORADO ---
  const generateProceduralLevel = (world, round, startX, floorY) => {
    const blockSize = 60;
    const blocks = [];
    
    let reinforcedProb = 0.25;
    if (round > 5) reinforcedProb = 0.40;
    if (round > 15) reinforcedProb = 0.60;

    const scale = Math.floor((round - 1) / 7); 

    const getType = () => Math.random() < reinforcedProb ? 'reinforced' : 'wood';
    const createBlock = (x, y, type) => {
      const isReinforced = type === 'reinforced';
      return Matter.Bodies.rectangle(x, y, blockSize, blockSize, {
        label: isReinforced ? 'block-hard' : 'block-wood',
        density: isReinforced ? 0.004 : 0.001,
        friction: isReinforced ? 0.4 : 0.6,
        restitution: 0.0,
        custom: { hp: isReinforced ? 3 : 1, maxHp: isReinforced ? 3 : 1, type }
      });
    };

    const patternId = ((round - 1) % 12) + 1; 

    switch(patternId) {
        case 1: // Torre Simple
            for (let i = 0; i < Math.min(12, 4 + scale + Math.floor(round/3)); i++) {
                const y = floorY - blockSize/2 - (i * blockSize);
                blocks.push(createBlock(startX - blockSize/2, y, getType()));
                blocks.push(createBlock(startX + blockSize/2, y, getType()));
            }
            break;
        case 2: // Pirámide Aleatoria
            const layers = Math.min(8, 3 + scale + Math.floor(round/5));
            for (let r = 0; r < layers; r++) {
                for (let c = 0; c <= r; c++) {
                    const x = startX + (c * blockSize) - (r * blockSize / 2);
                    const y = floorY - blockSize/2 - ((layers - 1 - r) * blockSize);
                    blocks.push(createBlock(x, y, getType()));
                }
            }
            break;
        case 3: // Castillo
            const towerH = 4 + scale;
            for(let i=0; i<towerH; i++){
                const y = floorY - blockSize/2 - (i * blockSize);
                blocks.push(createBlock(startX - blockSize*1.5, y, 'reinforced')); 
                blocks.push(createBlock(startX + blockSize*1.5, y, 'reinforced')); 
            }
             for(let i=0; i<2+scale; i++) {
                blocks.push(createBlock(startX, floorY - blockSize/2 - i*blockSize, 'wood'));
             }
            break;
        case 4: // Puente Colgante
            const bridgeH = 1 + scale; 
            for(let i=0; i<bridgeH; i++) {
                const y = floorY - blockSize/2 - i*blockSize;
                blocks.push(createBlock(startX - blockSize*2, y, 'reinforced'));
                blocks.push(createBlock(startX + blockSize*2, y, 'reinforced'));
            }
            const plankY = floorY - blockSize*bridgeH - blockSize/2;
            blocks.push(Matter.Bodies.rectangle(startX, plankY, blockSize * 5, 20, { label: 'plank', density: 0.005 }));
            for(let i=0; i<=scale; i++) {
                blocks.push(createBlock(startX, plankY - blockSize/2 - 10 - i*blockSize, 'wood'));
                if(scale > 1) {
                    blocks.push(createBlock(startX - blockSize, plankY - blockSize/2 - 10, 'wood'));
                    blocks.push(createBlock(startX + blockSize, plankY - blockSize/2 - 10, 'wood'));
                }
            }
            break;
        case 5: // Pared Doble
            const wallH = 5 + scale;
            for(let i=0; i<wallH; i++){
                const y = floorY - blockSize/2 - (i * blockSize);
                blocks.push(createBlock(startX - blockSize*0.6, y, 'wood'));
                blocks.push(createBlock(startX + blockSize*0.6, y, 'reinforced'));
            }
            break;
        case 6: // L Lateral
             const lHeight = 3 + scale;
             for(let i=0; i<lHeight; i++) blocks.push(createBlock(startX, floorY - blockSize/2 - i*blockSize, 'reinforced'));
             for(let i=1; i<=2+scale; i++) blocks.push(createBlock(startX + i*blockSize, floorY - blockSize/2, 'wood'));
             break;
        case 7: // Zig Zag
             const zigH = 6 + scale;
             for(let i=0; i<zigH; i++){
                 const offset = (i % 2 === 0) ? 0 : blockSize/2;
                 blocks.push(createBlock(startX + offset, floorY - blockSize/2 - i*blockSize, getType()));
             }
             break;
        case 8: // Diamante
             for(let i=-1; i<=1; i++) blocks.push(createBlock(startX + i*blockSize, floorY - blockSize/2, 'reinforced'));
             for(let h=0; h <= scale; h++) {
                 const y = floorY - blockSize*1.5 - h*blockSize;
                 for(let i=-0.5; i<=0.5; i+=1) blocks.push(createBlock(startX + i*blockSize, y, 'wood'));
             }
             blocks.push(createBlock(startX, floorY - blockSize*(2.5+scale), 'wood'));
             break;
        case 9: // Estrella
             blocks.push(createBlock(startX, floorY - blockSize/2, 'reinforced')); 
             const centerH = 1 + scale;
             for(let i=0; i<centerH; i++) {
                 const y = floorY - blockSize*1.5 - i*blockSize;
                 blocks.push(createBlock(startX, y, 'reinforced')); 
                 if (i===0) {
                     blocks.push(createBlock(startX - blockSize, y, 'wood')); 
                     blocks.push(createBlock(startX + blockSize, y, 'wood')); 
                 }
             }
             blocks.push(createBlock(startX, floorY - blockSize*(1.5+centerH), 'wood')); 
             break;
        case 10: // Arco Romano
             const arcH = scale;
             for(let i=0; i<=arcH; i++) {
                 const y = floorY - blockSize/2 - i*blockSize;
                 blocks.push(createBlock(startX - blockSize*1.5, y, 'reinforced'));
                 blocks.push(createBlock(startX + blockSize*1.5, y, 'reinforced'));
             }
             const topY = floorY - blockSize*(1.5+arcH);
             blocks.push(createBlock(startX - blockSize*1.5, topY, 'reinforced'));
             blocks.push(createBlock(startX + blockSize*1.5, topY, 'reinforced'));
             blocks.push(Matter.Bodies.rectangle(startX, topY - blockSize/2, blockSize * 4, 20, { label: 'plank', density: 0.005 }));
             blocks.push(createBlock(startX, topY - blockSize - 10, 'wood'));
             break;
        case 11: // Trampa
             blocks.push(createBlock(startX - blockSize/2, floorY - blockSize/2, 'wood'));
             blocks.push(createBlock(startX + blockSize/2, floorY - blockSize/2, 'wood'));
             for(let i=0; i<scale; i++) {
                 blocks.push(createBlock(startX - blockSize/2, floorY - blockSize*1.5 - i*blockSize, 'wood'));
                 blocks.push(createBlock(startX + blockSize/2, floorY - blockSize*1.5 - i*blockSize, 'wood'));
             }
             const trapY = floorY - blockSize*(1.5 + scale);
             blocks.push(Matter.Bodies.rectangle(startX, trapY, blockSize * 2.2, 20, { label: 'plank' }));
             blocks.push(createBlock(startX, trapY - blockSize, 'reinforced'));
             break;
        default: // 12 - Fortaleza
             const fortH = 3 + Math.floor(scale/2);
             const fortW = 1 + Math.ceil(scale/2);
             for(let r=0; r<fortH; r++){
                 for(let c=-fortW; c<=fortW; c++){
                     blocks.push(createBlock(startX + c*blockSize, floorY - blockSize/2 - r*blockSize, r===0 ? 'reinforced' : getType()));
                 }
             }
             break;
    }
    
    Matter.World.add(world, blocks);
    return blocks.length;
  };

  // --- INICIALIZACIÓN DEL JUEGO ---
  const initLevel = useCallback((levelIdOrMode, roundNum = 1, currentAmmo = null) => {
    if (gameOverTimeoutRef.current) {
      clearTimeout(gameOverTimeoutRef.current);
      gameOverTimeoutRef.current = null;
    }

    let startingAmmo = 0;

    if (gameMode === 'infinite') {
        if (currentAmmo !== null) {
            startingAmmo = currentAmmo === 0 ? 3 : currentAmmo + 3;
        } else {
            startingAmmo = 10;
        }
    } else {
        const levelData = LEVELS.find(l => l.id === levelIdOrMode);
        startingAmmo = levelData.ammo;
    }

    setAmmo(startingAmmo);
    game.current.currentAmmoRef = startingAmmo;
    
    if (gameMode === 'campaign' || roundNum === 1) {
       setScore(0);
    }
    
    setBonusScore(0);
    game.current.particles = [];
    game.current.bodiesToRemove = [];
    game.current.power = 0;
    game.current.isDragging = false;

    if (engineRef.current) {
      Matter.World.clear(engineRef.current.world);
      Matter.Engine.clear(engineRef.current);
    }

    const engine = Matter.Engine.create();
    engine.gravity.y = 1.2;
    engineRef.current = engine;
    
    // --- LÓGICA DE ESCALADO VISUAL ---
    // Calculamos un factor de escala para que el juego siempre "quepa" verticalmente.
    // Usamos una altura base de referencia (ej: 900px).
    const targetHeight = 900; 
    const scale = Math.min(1, window.innerHeight / targetHeight); // Si la pantalla es más pequeña, scale < 1
    game.current.viewScale = scale;

    // Dimensiones "virtuales" del mundo físico
    // Si la pantalla es pequeña, el mundo físico es más grande que la pantalla, y luego lo "encogemos" con scale.
    const width = window.innerWidth / scale;
    const height = window.innerHeight / scale;
    
    game.current.width = width;
    game.current.height = height;

    const world = engine.world;
    
    // 1. Límites y Suelo (Usando dimensiones virtuales)
    const ground = Matter.Bodies.rectangle(width / 2, height + 50, width * 3, 200, { 
      isStatic: true, label: 'ground', friction: 1 
    });
    const wallRight = Matter.Bodies.rectangle(width + 200, height / 2, 200, height * 3, { isStatic: true });
    const wallLeft = Matter.Bodies.rectangle(-200, height / 2, 200, height * 3, { isStatic: true });
    
    // 2. PLATAFORMA ELEVADA
    const platformWidth = 500;
    const platformHeight = 20;
    const platformX = width * 0.7; 
    const platformY = height - 150; 
    
    const platform = Matter.Bodies.rectangle(platformX, platformY, platformWidth, platformHeight, {
        isStatic: true, label: 'platform', friction: 1, render: { fillStyle: '#555' }
    });

    Matter.World.add(world, [ground, wallRight, wallLeft, platform]);

    // 3. GENERACIÓN DE ESTRUCTURAS
    const floorY = platformY - platformHeight/2;

    if (gameMode === 'infinite') {
        const count = generateProceduralLevel(world, roundNum, platformX, floorY);
        game.current.targetsCount = count;
    } else {
        const levelData = LEVELS.find(l => l.id === levelIdOrMode);
        const blockSize = 60;
        const startX = platformX;
        let blocks = [];
        const createBlock = (x, y, type) => {
            const isReinforced = type === 'reinforced';
            return Matter.Bodies.rectangle(x, y, blockSize, blockSize, {
                label: isReinforced ? 'block-hard' : 'block-wood',
                density: isReinforced ? 0.004 : 0.001,
                friction: isReinforced ? 0.4 : 0.6,
                restitution: 0.0,
                custom: { hp: isReinforced ? 3 : 1, maxHp: isReinforced ? 3 : 1, type }
            });
        };
        
        if (levelData.type === 'pyramid') {
             for (let row = 0; row < 6; row++) {
                for (let col = 0; col <= row; col++) {
                  const x = startX + (col * blockSize) - (row * blockSize / 2);
                  const y = floorY - blockSize/2 - ((5 - row) * blockSize);
                  blocks.push(createBlock(x, y, row % 2 === 0 ? 'wood' : 'reinforced'));
                }
             }
        } else if (levelData.type === 'tower') {
            let yOffset = 0;
            for (let i = 0; i < 6; i++) {
                const y = floorY - blockSize/2 - (i * blockSize) - yOffset;
                blocks.push(createBlock(startX - blockSize/2, y, i % 2 === 0 ? 'reinforced' : 'wood'));
                blocks.push(createBlock(startX + blockSize/2, y, i % 2 !== 0 ? 'reinforced' : 'wood'));
                if (i % 2 === 1 && i < 5) {
                   const plankH = 20;
                   blocks.push(Matter.Bodies.rectangle(startX, y - blockSize/2 - plankH/2, blockSize * 2.2, plankH, {
                     density: 0.005, label: 'plank', friction: 0.8, restitution: 0
                   }));
                   yOffset += plankH;
                }
            }
        } else if (levelData.type === 'fort') {
             blocks.push(createBlock(startX - blockSize, floorY - 30, 'reinforced'));
             blocks.push(createBlock(startX + blockSize, floorY - 30, 'reinforced'));
             blocks.push(createBlock(startX - blockSize, floorY - 90, 'reinforced'));
             blocks.push(createBlock(startX + blockSize, floorY - 90, 'reinforced'));
             blocks.push(Matter.Bodies.rectangle(startX, floorY - 130, blockSize * 3, 20, { label: 'plank', density: 0.005 }));
             blocks.push(createBlock(startX, floorY - 170, 'wood'));
        }
        Matter.World.add(world, blocks);
        game.current.targetsCount = blocks.length;
    }

    Matter.Events.on(engine, 'collisionStart', (event) => {
      event.pairs.forEach((pair) => {
        const { bodyA, bodyB } = pair;
        
        if ((bodyA.label === 'ground' && bodyB.label.startsWith('block')) || 
            (bodyB.label === 'ground' && bodyA.label.startsWith('block'))) {
            
            const block = bodyA.label.startsWith('block') ? bodyA : bodyB;
            if (!game.current.bodiesToRemove.includes(block)) {
                game.current.bodiesToRemove.push(block);
                playSound('break');
                const points = block.custom.type === 'reinforced' ? 500 : 200;
                setScore(s => s + points);
                spawnParticles(block.position.x, block.position.y, 15, '#e53e3e');
            }
            return; 
        }

        const speed = pair.collision.normal.x * (bodyA.velocity.x - bodyB.velocity.x) + 
                      pair.collision.normal.y * (bodyA.velocity.y - bodyB.velocity.y);
        
        const handleDamage = (body, impact) => {
          if (body.label.startsWith('block') && Math.abs(impact) > 8) {
            body.custom.hp -= 1;
            playSound('hit');
            spawnParticles(body.position.x, body.position.y, 3, '#cbd5e0');

            if (body.custom.hp <= 0 && !game.current.bodiesToRemove.includes(body)) {
              game.current.bodiesToRemove.push(body);
              playSound('break');
              const points = body.custom.type === 'reinforced' ? 500 : 200;
              setScore(s => s + points);
              spawnParticles(body.position.x, body.position.y, 12, body.custom.type === 'reinforced' ? '#744210' : '#d69e2e');
            }
          }
        };

        handleDamage(bodyA, speed);
        handleDamage(bodyB, speed);
      });
    });

  }, [gameMode]);

  // --- LOOP RENDER ---
  const renderLoop = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    const engine = engineRef.current;

    if (!canvas || !ctx || !engine) return;

    Matter.Engine.update(engine, 1000 / 60);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // --- APLICAR ESCALA GLOBAL ---
    // Esto hace que todo el juego se vea más pequeño para caber en la pantalla del móvil
    ctx.save();
    ctx.scale(game.current.viewScale, game.current.viewScale);

    drawBackground(ctx, game.current.width, game.current.height);

    if (game.current.bodiesToRemove.length > 0) {
      Matter.World.remove(engine.world, game.current.bodiesToRemove);
      game.current.bodiesToRemove = [];
      
      const remainingTargets = engine.world.bodies.filter(b => b.label.startsWith('block'));
      if (remainingTargets.length === 0) {
        
        if (gameOverTimeoutRef.current) {
            clearTimeout(gameOverTimeoutRef.current);
            gameOverTimeoutRef.current = null;
        }

        setGameState(gameMode === 'infinite' ? 'roundWon' : 'won');
        playSound('win');
        
        const remainingAmmo = game.current.currentAmmoRef;
        const bonus = remainingAmmo * 500;
        setBonusScore(bonus);
        setScore(s => {
            const newScore = s + bonus;
            if (gameMode === 'infinite' && newScore > highScore) {
                setHighScore(newScore);
                localStorage.setItem('cannonBlastHS', newScore.toString());
            }
            return newScore;
        });
      }
    }

    Matter.Composite.allBodies(engine.world).forEach(body => {
      ctx.save();
      ctx.translate(body.position.x, body.position.y);
      ctx.rotate(body.angle);

      if (body.label === 'ground') drawGround(ctx, body);
      else if (body.label === 'platform') drawPlatform(ctx, body); 
      else if (body.label.startsWith('block')) drawBlock(ctx, body);
      else if (body.label === 'projectile') drawProjectile(ctx);
      else if (body.label === 'plank') drawPlank(ctx, body);

      ctx.restore();
    });

    drawCannon(ctx, game.current);
    updateAndDrawParticles(ctx);

    ctx.restore(); // Restaurar escala

    renderReqRef.current = requestAnimationFrame(renderLoop);
  }, [gameMode, highScore]);

  // --- DIBUJO ---
  const drawBackground = (ctx, w, h) => {
    if (gameMode === 'infinite') {
        const grad = ctx.createLinearGradient(0, 0, 0, h);
        grad.addColorStop(0, '#2b1055'); 
        grad.addColorStop(1, '#7597de'); 
        ctx.fillStyle = grad;
        ctx.fillRect(0,0,w,h);
        
        ctx.fillStyle = 'rgba(255,255,255,0.2)';
        for(let i=0; i<10; i++) {
           ctx.beginPath(); 
           ctx.arc(w*0.1*i, h*0.2 + Math.sin(i)*50, 2, 0, Math.PI*2);
           ctx.fill();
        }
    } else {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.beginPath(); ctx.arc(w * 0.2, h * 0.2, 60, 0, Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.arc(w * 0.25, h * 0.22, 80, 0, Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.arc(w * 0.8, h * 0.15, 50, 0, Math.PI*2); ctx.fill();
    }
  };
  
  const drawGround = (ctx, body) => {
    const w = body.bounds.max.x - body.bounds.min.x;
    const h = body.bounds.max.y - body.bounds.min.y;
    const grad = ctx.createLinearGradient(0, -h/2, 0, h/2);
    grad.addColorStop(0, '#e53e3e');
    grad.addColorStop(1, '#9b2c2c');
    ctx.fillStyle = grad;
    ctx.fillRect(-w/2, -h/2, w, h);
    ctx.fillStyle = '#fc8181';
    ctx.fillRect(-w/2, -h/2, w, 10);
  };
  
  const drawPlatform = (ctx, body) => {
    const w = body.bounds.max.x - body.bounds.min.x;
    const h = body.bounds.max.y - body.bounds.min.y;
    const grad = ctx.createLinearGradient(0, -h/2, 0, h/2);
    grad.addColorStop(0, '#718096');
    grad.addColorStop(1, '#2d3748');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.moveTo(-w/2, -h/2); ctx.lineTo(w/2, -h/2); ctx.lineTo(w/2 - 10, h/2); ctx.lineTo(-w/2 + 10, h/2); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#cbd5e0'; ctx.lineWidth = 2; ctx.stroke();
  };

  const drawBlock = (ctx, body) => {
    const w = body.bounds.max.x - body.bounds.min.x;
    const h = body.bounds.max.y - body.bounds.min.y;
    const isReinforced = body.custom.type === 'reinforced';
    const grad = ctx.createLinearGradient(-w/2, -h/2, w/2, h/2);
    if (isReinforced) { grad.addColorStop(0, '#744210'); grad.addColorStop(1, '#5D3309'); } 
    else { grad.addColorStop(0, '#F6E05E'); grad.addColorStop(1, '#D69E2E'); }
    ctx.fillStyle = grad; ctx.fillRect(-w/2, -h/2, w, h);
    ctx.lineWidth = 2; ctx.strokeStyle = isReinforced ? '#2D3748' : '#B7791F'; ctx.strokeRect(-w/2, -h/2, w, h);
    if (isReinforced) {
      ctx.fillStyle = '#A0AEC0'; const r = 3;
      [-1, 1].forEach(dx => [-1, 1].forEach(dy => { ctx.beginPath(); ctx.arc(dx*(w/2-6), dy*(h/2-6), r, 0, Math.PI*2); ctx.fill(); }));
      ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.moveTo(-w/2, -h/2); ctx.lineTo(w/2, h/2); ctx.stroke(); ctx.beginPath(); ctx.moveTo(w/2, -h/2); ctx.lineTo(-w/2, h/2); ctx.stroke();
    } else {
      ctx.strokeStyle = 'rgba(139, 69, 19, 0.3)'; ctx.beginPath(); ctx.rect(-w/2+10, -h/2+10, w-20, h-20); ctx.stroke();
    }
    if (body.custom.hp < body.custom.maxHp) {
      ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-10, -10); ctx.lineTo(5, 5); ctx.lineTo(-5, 15); ctx.stroke();
    }
  };

  const drawPlank = (ctx, body) => {
    const w = body.bounds.max.x - body.bounds.min.x;
    const h = body.bounds.max.y - body.bounds.min.y;
    ctx.fillStyle = '#8B4513'; ctx.fillRect(-w/2, -h/2, w, h);
    ctx.strokeStyle = '#5D3309'; ctx.strokeRect(-w/2, -h/2, w, h);
  };

  const drawProjectile = (ctx) => {
    ctx.beginPath(); ctx.arc(0, 0, 15, 0, Math.PI * 2);
    const grad = ctx.createRadialGradient(-5, -5, 2, 0, 0, 15);
    grad.addColorStop(0, '#E2E8F0'); grad.addColorStop(1, '#2D3748');
    ctx.fillStyle = grad; ctx.fill();
    ctx.strokeStyle = '#1A202C'; ctx.lineWidth = 1; ctx.stroke();
  };

  const drawCannon = (ctx, gameStateRef) => {
    const x = 150; const y = gameStateRef.height - 150;
    ctx.fillStyle = '#2D3748'; ctx.beginPath(); ctx.arc(x, y + 20, 30, Math.PI, 0); ctx.fill();
    ctx.save(); ctx.translate(x, y); ctx.rotate(gameStateRef.cannonAngle);
    const grad = ctx.createLinearGradient(0, -15, 0, 15);
    grad.addColorStop(0, '#4A5568'); grad.addColorStop(0.5, '#A0AEC0'); grad.addColorStop(1, '#2D3748');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.moveTo(0, -15); ctx.lineTo(80, -12); ctx.lineTo(80, 12); ctx.lineTo(0, 15); ctx.fill(); ctx.stroke();
    ctx.restore();
    ctx.beginPath(); ctx.arc(x, y, 12, 0, Math.PI*2); ctx.fillStyle = '#ECC94B'; ctx.fill();
    if (gameStateRef.isDragging || !gameStateRef.isDragging) {
      const power = gameStateRef.isDragging ? Math.max(0.3, gameStateRef.power) : 0.5;
      const speed = power * 35; 
      const vx = Math.cos(gameStateRef.cannonAngle) * speed;
      const vy = Math.sin(gameStateRef.cannonAngle) * speed;
      ctx.fillStyle = gameStateRef.isDragging ? 'rgba(255, 255, 255, 0.8)' : 'rgba(255, 255, 255, 0.3)';
      for (let i = 1; i < 20; i++) {
        const t = i * 1.5; const dx = vx * t; const dy = vy * t + 0.5 * 1.2 * t * t * 0.16;
        if (y + dy > gameStateRef.height - 60) break;
        ctx.beginPath(); ctx.arc(x + dx, y + dy, gameStateRef.isDragging ? 4 : 2, 0, Math.PI*2); ctx.fill();
      }
    }
  };

  const spawnParticles = (x, y, count, color) => {
    for (let i = 0; i < count; i++) {
      game.current.particles.push({
        x, y, vx: (Math.random() - 0.5) * 15, vy: (Math.random() - 0.5) * 15, life: 1.0, color
      });
    }
  };

  const updateAndDrawParticles = (ctx) => {
    for (let i = game.current.particles.length - 1; i >= 0; i--) {
      const p = game.current.particles[i];
      p.x += p.vx; p.y += p.vy; p.vy += 0.4; p.life -= 0.03;
      if (p.life <= 0) { game.current.particles.splice(i, 1); continue; }
      ctx.globalAlpha = p.life; ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI*2); ctx.fill();
      ctx.globalAlpha = 1;
    }
  };

  // --- INTERACCIÓN AJUSTADA CON ESCALA ---
  const handlePointerDown = (e) => {
    if (gameState !== 'playing') return;
    const rect = canvasRef.current.getBoundingClientRect();
    
    // Ajustar coordenadas según la escala actual
    const x = (e.clientX - rect.left) / game.current.viewScale;
    const y = (e.clientY - rect.top) / game.current.viewScale;
    
    if (x < game.current.width * 0.5) {
      game.current.isDragging = true;
      game.current.dragStart = { x, y };
    }
  };

  const handlePointerMove = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / game.current.viewScale;
    const y = (e.clientY - rect.top) / game.current.viewScale;
    
    const cannonX = 150; const cannonY = game.current.height - 150;
    const dx = x - cannonX; const dy = y - cannonY;
    game.current.cannonAngle = Math.atan2(dy, dx);
    if (game.current.isDragging) {
      const dist = Math.sqrt(dx*dx + dy*dy);
      game.current.power = Math.min(dist, 300) / 300; 
    }
  };

  const handlePointerUp = () => {
    if (!game.current.isDragging) return;
    game.current.isDragging = false;
    fireCannon();
  };

  const fireCannon = () => {
    if (ammo <= 0) return;

    setAmmo(prev => {
      const newAmmo = prev - 1;
      game.current.currentAmmoRef = newAmmo;
      if (newAmmo === 0) {
        gameOverTimeoutRef.current = setTimeout(() => {
          const enemies = Matter.Composite.allBodies(engineRef.current.world).filter(b => b.label.startsWith('block'));
          if (enemies.length > 0) {
             setGameState(current => current === 'playing' ? 'lost' : current);
          }
        }, 5000);
      }
      return newAmmo;
    });
    
    playSound('shoot');

    const angle = game.current.cannonAngle;
    const power = Math.max(0.3, game.current.power); 
    const speed = power * 35; 
    const cannonX = 150; const cannonY = game.current.height - 150;
    const barrelLen = 80;

    const ball = Matter.Bodies.circle(
      cannonX + Math.cos(angle) * barrelLen,
      cannonY + Math.sin(angle) * barrelLen,
      15, { label: 'projectile', density: 0.05, restitution: 0.6, friction: 0.005 }
    );

    Matter.World.add(engineRef.current.world, ball);
    Matter.Body.setVelocity(ball, { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed });
  };

  // --- EFECTOS ---
  useEffect(() => {
    if (gameState === 'playing') {
      if (gameMode === 'campaign') {
         initLevel(currentLevelId);
      } else {
         initLevel('infinite', round, round === 1 ? null : ammo); 
      }
      renderReqRef.current = requestAnimationFrame(renderLoop);
    } else {
      if (renderReqRef.current) cancelAnimationFrame(renderReqRef.current);
    }
    return () => cancelAnimationFrame(renderReqRef.current);
  }, [gameState, currentLevelId, initLevel, renderLoop]);

  // --- COMPONENTES UI ---

  if (!isLandscape) {
    return (
      <div className="fixed inset-0 z-[100] bg-black text-white flex flex-col items-center justify-center p-8 text-center animate-in fade-in duration-300">
        <Smartphone size={64} className="mb-6 animate-spin-slow text-yellow-400" />
        <h2 className="text-3xl font-black mb-4">GIRA TU DISPOSITIVO</h2>
        <p className="text-gray-300 text-lg max-w-md">
          Para la mejor experiencia de destrucción, Cannon Blast debe jugarse en modo horizontal.
        </p>
      </div>
    );
  }

  // MENÚ PRINCIPAL AJUSTADO CON SCROLL
  const MainMenu = () => (
    <div className="absolute inset-0 z-50 bg-gradient-to-br from-orange-100/90 via-sky-200/90 to-emerald-100/90 backdrop-blur-sm overflow-y-auto">
      <div className="min-h-full flex flex-col items-center justify-center p-8">
        <div className="bg-white/80 p-8 md:p-12 rounded-3xl shadow-2xl text-center max-w-2xl border border-white/50 backdrop-blur-md animate-in zoom-in duration-500">
          <h1 className="text-4xl md:text-8xl font-black mb-4 bg-gradient-to-r from-orange-500 to-amber-600 bg-clip-text text-transparent drop-shadow-xl">
            CANNON BLAST
          </h1>
          <p className="text-gray-600 text-lg md:text-2xl mb-8 font-medium">Física, Destrucción y Precisión</p>
          
          <button 
            onClick={() => {
              enterGameMode();
              setGameState('levelSelect');
            }}
            className="group relative px-8 py-4 md:px-10 md:py-5 bg-gradient-to-r from-emerald-500 to-teal-600 rounded-2xl shadow-xl hover:shadow-2xl hover:scale-105 transition-all duration-300 w-full md:w-auto"
          >
            <span className="relative flex items-center justify-center gap-3 text-xl md:text-3xl font-bold text-white tracking-wide">
              <Play fill="currentColor" size={24} /> JUGAR AHORA
            </span>
          </button>
        </div>
      </div>
    </div>
  );

  const LevelSelect = () => (
    <div className="absolute inset-0 z-50 bg-black/80 backdrop-blur-md overflow-y-auto">
      <div className="min-h-full flex flex-col items-center justify-center p-8">
        <h2 className="text-4xl md:text-5xl font-bold text-white mb-8 drop-shadow-lg text-center mt-8">Selecciona Modo</h2>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full max-w-5xl flex-shrink-0">
          {/* MODO INFINITO CARD */}
          <button
            onClick={() => {
              enterGameMode();
              setGameMode('infinite');
              setRound(1);
              setGameState('playing');
            }}
            className="col-span-1 md:col-span-3 group relative bg-gradient-to-r from-indigo-900 to-purple-900 border-4 border-purple-500/30 hover:border-purple-400 p-6 md:p-8 rounded-3xl transition-all hover:-translate-y-2 shadow-2xl overflow-hidden flex flex-col md:flex-row items-center gap-8"
          >
            <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/stardust.png')] opacity-20"></div>
            <div className="w-24 h-24 md:w-32 md:h-32 rounded-full bg-purple-600/30 flex items-center justify-center animate-spin-slow shadow-[0_0_30px_rgba(168,85,247,0.5)]">
              <Infinity size={48} className="text-purple-200" />
            </div>
            <div className="flex-1 text-center md:text-left z-10">
               <h3 className="text-2xl md:text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r from-purple-200 to-pink-200 mb-2">MODO INFINITO</h3>
               <p className="text-purple-200 text-sm md:text-lg mb-4">¡Supervivencia extrema! Balas sobrantes = Bonus</p>
               <div className="flex items-center justify-center md:justify-start gap-4">
                  <span className="bg-black/40 px-4 py-2 rounded-lg text-purple-300 flex items-center gap-2 border border-purple-500/30 text-sm">
                    <Trophy size={16}/> Récord: {highScore}
                  </span>
               </div>
            </div>
          </button>

          {/* NIVELES NORMALES */}
          {LEVELS.map((level) => (
            <button
              key={level.id}
              onClick={() => {
                enterGameMode();
                setGameMode('campaign');
                setCurrentLevelId(level.id);
                setGameState('playing');
              }}
              className="group relative bg-white/10 border-2 border-white/20 hover:border-emerald-400 p-6 rounded-3xl transition-all hover:-translate-y-2 hover:bg-white/20 flex flex-col items-center gap-4 overflow-hidden"
            >
              <div className={`w-16 h-16 md:w-20 md:h-20 rounded-2xl flex items-center justify-center text-2xl md:text-4xl font-bold shadow-lg transform group-hover:scale-110 transition-transform ${
                 level.id === 1 ? 'bg-gradient-to-br from-yellow-400 to-orange-500 text-white' : 
                 'bg-gradient-to-br from-blue-400 to-indigo-500 text-white'
              }`}>
                {level.id}
              </div>
              <div className="text-center">
                <h3 className="text-xl md:text-2xl font-bold text-white mb-1">{level.name}</h3>
                <p className="text-gray-300 text-xs md:text-sm">Munición: {level.ammo}</p>
              </div>
            </button>
          ))}
        </div>

        <button 
          onClick={() => setGameState('menu')}
          className="mt-12 mb-8 px-8 py-3 bg-white text-gray-900 rounded-full font-bold text-lg hover:bg-gray-200 transition-all shadow-lg flex items-center gap-2 hover:scale-105 active:scale-95"
        >
          <RotateCcw size={20} /> Volver al Menú
        </button>
      </div>
    </div>
  );

  const VictoryScreen = () => {
    // AJUSTADO CON SCROLL
    if (gameMode === 'infinite') {
        return (
            <div className="absolute inset-0 z-50 bg-black/90 backdrop-blur-lg animate-in zoom-in duration-300 overflow-y-auto">
                <div className="min-h-full flex flex-col items-center justify-center p-8">
                    <h2 className="text-4xl md:text-7xl font-black text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-500 mb-4 drop-shadow-2xl text-center">
                       ¡RONDA {round} SUPERADA!
                    </h2>
                    <div className="flex gap-2 mb-8 animate-bounce">
                        <Star size={32} className="text-yellow-400 fill-yellow-400" />
                        <Star size={48} className="text-yellow-400 fill-yellow-400" />
                        <Star size={32} className="text-yellow-400 fill-yellow-400" />
                    </div>
                    
                    <div className="bg-white/10 p-6 rounded-2xl border border-white/10 mb-8 text-center min-w-[300px]">
                        <p className="text-gray-400 uppercase text-sm font-bold tracking-widest mb-2">Munición Restante</p>
                        <div className="text-4xl text-white font-mono mb-4">{ammo} <span className="text-sm text-gray-500">balas</span></div>
                        <div className="h-px bg-white/10 w-full mb-4"></div>
                        <p className="text-purple-300 uppercase text-sm font-bold tracking-widest mb-1">Bonus de Puntos</p>
                        <div className="text-3xl text-purple-400 font-bold mb-4">+{bonusScore}</div>
                        <p className="text-gray-400 uppercase text-xs">Total Score</p>
                        <div className="text-xl text-white font-mono">{score}</div>
                    </div>

                    <div className="flex gap-4">
                         <button 
                            onClick={() => {
                                setRound(r => r + 1);
                                setGameState('playing'); 
                            }}
                            className="px-6 py-3 md:px-10 md:py-4 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 rounded-xl text-white font-bold text-sm md:text-xl shadow-lg hover:shadow-purple-500/50 hover:scale-105 transition-all flex items-center gap-2"
                         >
                            SIGUIENTE RONDA <Play fill="currentColor" />
                         </button>
                         <button 
                           onClick={() => setGameState('menu')}
                           className="px-6 py-4 bg-white/10 hover:bg-white/20 rounded-xl text-white font-bold"
                         >
                           <Menu />
                         </button>
                    </div>
                </div>
            </div>
        );
    }

    const level = LEVELS.find(l => l.id === currentLevelId);
    return (
      <div className="absolute inset-0 z-50 bg-black/80 backdrop-blur-lg animate-in fade-in duration-500 overflow-y-auto">
        <div className="min-h-full flex flex-col items-center justify-center p-8">
          <h2 className="text-4xl md:text-7xl font-black text-transparent bg-clip-text bg-gradient-to-r from-yellow-300 to-yellow-600 mb-8 drop-shadow-2xl text-center">
            ¡NIVEL COMPLETADO!
          </h2>
          
          <div className="flex justify-center gap-4 mb-8">
            {[0, 1, 2].map((idx) => {
              const active = score >= level.starsThreshold[idx];
              return (
               <Star 
                 key={idx} 
                 size={48} 
                 fill={active ? "#fbbf24" : "none"}
                 className={`${active ? "text-yellow-400 animate-bounce" : "text-gray-700"}`} 
                 style={{ animationDelay: `${idx * 0.2}s` }}
               />
              );
            })}
          </div>
          
          <div className="text-white text-3xl mb-4 font-mono bg-white/10 inline-block px-8 py-4 rounded-xl">
            Puntuación: <span className="text-emerald-400 font-bold">{score}</span>
          </div>
          
          {bonusScore > 0 && (
            <div className="text-yellow-400 text-lg mb-12 font-bold animate-pulse">
              + {bonusScore} Bonus de Munición
            </div>
          )}
  
          <div className="flex flex-col md:flex-row gap-6 justify-center">
             <button 
               onClick={() => {
                 setGameState('playing');
               }}
               className="px-8 py-4 bg-white/10 hover:bg-white/20 rounded-xl text-white font-bold flex items-center justify-center gap-2 transition-colors border border-white/10"
             >
               <RotateCcw size={20} /> Repetir
             </button>
             
             {currentLevelId < LEVELS.length && (
               <button 
                 onClick={() => {
                   setCurrentLevelId(l => l + 1);
                   setGameState('playing');
                 }}
                 className="px-8 py-4 bg-emerald-500 hover:bg-emerald-600 rounded-xl text-white font-bold flex items-center justify-center gap-2 shadow-lg hover:shadow-emerald-500/50 transition-all hover:scale-105"
               >
                 Siguiente Nivel <Play size={20} fill="currentColor"/>
               </button>
             )}
             
             <button 
               onClick={() => setGameState('levelSelect')}
               className="px-8 py-4 bg-blue-600 hover:bg-blue-700 rounded-xl text-white font-bold flex items-center justify-center gap-2 shadow-lg"
             >
               <Menu size={20} /> Niveles
             </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-gradient-to-b from-sky-300 to-sky-100 select-none font-sans touch-none">
      
      {/* --- CANVAS DE JUEGO --- */}
      <canvas
        ref={canvasRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        className={`absolute inset-0 cursor-crosshair touch-none ${gameState !== 'playing' ? 'blur-sm scale-105 opacity-50' : 'opacity-100'} transition-all duration-700`}
      />

      {/* --- HUD --- */}
      {gameState === 'playing' && (
        <div className="absolute top-0 left-0 right-0 p-4 md:p-6 flex justify-between items-start pointer-events-none z-10">
          <div className="flex flex-col gap-2">
            
            {/* HUD MODO INFINITO */}
            {gameMode === 'infinite' ? (
                <div className="flex gap-4">
                     <div className="bg-purple-900/80 backdrop-blur-md text-white px-4 py-2 rounded-2xl border border-purple-500/50 shadow-lg animate-in slide-in-from-top-4">
                        <span className="text-purple-300 text-[10px] md:text-xs uppercase font-bold tracking-wider block">Ronda</span>
                        <div className="text-xl md:text-2xl font-black flex items-center gap-2">
                            <Infinity size={20} className="text-purple-400" /> {round}
                        </div>
                     </div>
                     <div className="bg-black/60 backdrop-blur-md text-white px-4 py-2 rounded-2xl border border-white/10 shadow-lg flex items-center gap-3 animate-in slide-in-from-left-4">
                        <span className="text-yellow-400"><Trophy size={16}/></span>
                        <div className="text-xl md:text-2xl font-mono font-bold">{score}</div>
                    </div>
                </div>
            ) : (
                /* HUD MODO CAMPAÑA */
                <>
                <div className="bg-black/60 backdrop-blur-md text-white px-4 py-2 rounded-2xl border border-white/10 shadow-lg animate-in slide-in-from-top-4">
                   <span className="text-gray-400 text-[10px] md:text-xs uppercase font-bold tracking-wider block">Objetivo</span>
                   <div className="text-lg md:text-xl font-black">{LEVELS.find(l => l.id === currentLevelId).name}</div>
                </div>
                <div className="bg-black/60 backdrop-blur-md text-white px-4 py-2 rounded-2xl border border-white/10 shadow-lg flex items-center gap-3 animate-in slide-in-from-left-4">
                   <span className="text-yellow-400"><Star fill="currentColor" size={16}/></span>
                   <div className="text-xl md:text-2xl font-mono font-bold">{score}</div>
                </div>
                </>
            )}
            
          </div>

          <div className="flex flex-col items-end gap-2">
            <div className={`backdrop-blur-md p-2 md:p-3 rounded-2xl border shadow-lg animate-in slide-in-from-right-4 ${gameMode === 'infinite' ? 'bg-purple-900/60 border-purple-500/30' : 'bg-black/60 border-white/10'}`}>
              <span className={`text-[10px] md:text-xs uppercase font-bold tracking-wider block mb-1 text-right ${gameMode === 'infinite' ? 'text-purple-300' : 'text-gray-400'}`}>Munición</span>
              <div className="flex gap-1 md:gap-2">
                {Array.from({ length: Math.max(0, ammo) }).map((_, i) => (
                  <div key={i} className={`w-4 h-4 md:w-8 md:h-8 rounded-full shadow-inner border animate-pulse ${gameMode === 'infinite' ? 'bg-gradient-to-br from-pink-400 to-purple-600 border-purple-800' : 'bg-gradient-to-br from-gray-300 to-gray-600 border-gray-800'}`}></div>
                ))}
                {ammo === 0 && <span className="text-red-400 font-bold px-2 self-center animate-pulse text-xs md:text-base">¡VACÍO!</span>}
              </div>
            </div>
            <button onClick={() => setGameState('menu')} className="pointer-events-auto bg-white/20 p-2 rounded-full hover:bg-white/40 transition-colors text-white">
               <Menu size={20} />
            </button>
          </div>
        </div>
      )}

      {/* --- OVERLAYS --- */}
      {gameState === 'menu' && <MainMenu />}
      {gameState === 'levelSelect' && <LevelSelect />}
      {gameState === 'won' || gameState === 'roundWon' ? <VictoryScreen /> : null}
      
      {gameState === 'lost' && (
        <div className="absolute inset-0 z-50 bg-black/80 backdrop-blur-md animate-in zoom-in overflow-y-auto">
           <div className="min-h-full flex flex-col items-center justify-center p-8">
             <h2 className="text-5xl md:text-6xl font-black text-red-500 mb-4 drop-shadow-lg text-center">GAME OVER</h2>
             {gameMode === 'infinite' ? (
                 <div className="text-center mb-8">
                     <p className="text-white text-xl md:text-2xl mb-2">Has sobrevivido <span className="text-purple-400 font-bold">{round}</span> Rondas</p>
                     <p className="text-gray-400">Puntuación Final: {score}</p>
                 </div>
             ) : (
                 <p className="text-white text-lg md:text-xl mb-8 opacity-80 text-center">Te has quedado sin balas de cañón.</p>
             )}
             
             <button 
               onClick={() => {
                 if (gameMode === 'infinite') {
                     setRound(1);
                     setScore(0);
                     setAmmo(10); // Reiniciar ammo
                 }
                 setGameState('playing');
                 initLevel(gameMode === 'infinite' ? 'infinite' : currentLevelId);
               }}
               className="px-8 py-4 bg-white text-black font-bold rounded-xl hover:bg-gray-200 transition-colors flex gap-2 shadow-xl hover:scale-105"
             >
               <RotateCcw /> Intentar de Nuevo
             </button>
             <button 
               onClick={() => setGameState('menu')}
               className="mt-8 text-gray-500 hover:text-white transition-colors"
             >
               Volver al Menú Principal
             </button>
           </div>
        </div>
      )}

    </div>
  );
}