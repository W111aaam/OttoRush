'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import characterModels from 'virtual:character-models';

type Phase = 'menu' | 'playing' | 'paused' | 'dying' | 'gameover';
type EntityKind = 'coin' | 'magnet' | 'enemy' | 'enemyAir';
type AssetKind = EntityKind | 'character' | 'explosion';
type Entity = { kind: EntityKind; lane: number; object: THREE.Object3D; active: boolean };
type GameApi = { start: () => void; pause: () => void; resume: () => void; move: (direction: number) => void; jump: () => void; slide: () => void };
type AudioApi = { setMusicVolume: (volume: number) => void; setSfxVolume: (volume: number) => void; ensureMusic: () => void };
type CharacterMode = 'main' | 'walk' | 'hurdle' | 'dog';
type LoadedModel = { scene: THREE.Object3D; animations: THREE.AnimationClip[] };

const LANES = [-2.7, 0, 2.7];
const PLAYER_Z = 3;
const AIR_ENEMY_BASE_Y = 1.62;

function fitModel(source: THREE.Object3D, height: number) {
  const model = cloneSkeleton(source);
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const fittedRoot = new THREE.Group();
  fittedRoot.add(model);
  fittedRoot.scale.setScalar(height / Math.max(size.y, 0.001));
  const fitted = new THREE.Box3().setFromObject(fittedRoot);
  const center = fitted.getCenter(new THREE.Vector3());
  fittedRoot.position.set(-center.x, -fitted.min.y, -center.z);
  const visualRoot = new THREE.Group();
  visualRoot.add(fittedRoot);
  visualRoot.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
  return visualRoot;
}

function forEachMaterial(object: THREE.Object3D, callback: (material: THREE.Material, mesh: THREE.Mesh) => void) {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach((material) => callback(material, child));
  });
}

export default function RunnerGame() {
  const mountRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<GameApi | null>(null);
  const audioApiRef = useRef<AudioApi | null>(null);
  const touchRef = useRef({ x: 0, y: 0 });
  const audioHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [phase, setPhase] = useState<Phase>('menu');
  const [loaded, setLoaded] = useState(0);
  const [score, setScore] = useState(0);
  const [coins, setCoins] = useState(0);
  const [distance, setDistance] = useState(0);
  const [magnetTime, setMagnetTime] = useState(0);
  const [lives, setLives] = useState(2);
  const [best, setBest] = useState(0);
  const [musicVolume, setMusicVolume] = useState(0.45);
  const [sfxVolume, setSfxVolume] = useState(0.8);
  const [audioControlsOpen, setAudioControlsOpen] = useState(false);

  useEffect(() => {
    setBest(Number(localStorage.getItem('otto-runner-best') || 0));
  }, []);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const bgMusic = new Audio('/audio/bg.mp4');
    bgMusic.loop = true;
    bgMusic.preload = 'auto';
    bgMusic.volume = musicVolume;
    let sfxLevel = sfxVolume;
    const activeSfx = new Set<HTMLAudioElement>();
    const ensureMusic = () => { void bgMusic.play().catch(() => undefined); };
    const playSfx = (name: 'default' | 'death' | 'hidden' | 'hurt1' | 'hurt2' | 'pause') => {
      const sound = new Audio(`/audio/${name}.mp3`);
      sound.volume = sfxLevel;
      activeSfx.add(sound);
      sound.addEventListener('ended', () => activeSfx.delete(sound), { once: true });
      void sound.play().catch(() => activeSfx.delete(sound));
    };
    audioApiRef.current = {
      setMusicVolume: (volume) => { bgMusic.volume = volume; if (volume > 0) ensureMusic(); },
      setSfxVolume: (volume) => { sfxLevel = volume; activeSfx.forEach((sound) => { sound.volume = volume; }); },
      ensureMusic,
    };
    ensureMusic();

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#8ed5ff');
    scene.fog = new THREE.Fog('#8ed5ff', 38, 118);
    const camera = new THREE.PerspectiveCamera(57, 1, 0.1, 190);
    camera.position.set(0, 5.4, 10.4);
    camera.lookAt(0, 1.1, -10);
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    mount.appendChild(renderer.domElement);

    scene.add(new THREE.HemisphereLight('#eefaff', '#354761', 2.5));
    const sun = new THREE.DirectionalLight('#fff4d3', 3.7);
    sun.position.set(-9, 16, 11);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -14;
    sun.shadow.camera.right = 14;
    sun.shadow.camera.top = 18;
    sun.shadow.camera.bottom = -5;
    scene.add(sun);

    const road = new THREE.Mesh(new THREE.PlaneGeometry(13, 190), new THREE.MeshStandardMaterial({ color: '#29323d', roughness: 0.94 }));
    road.rotation.x = -Math.PI / 2;
    road.position.z = -77;
    road.receiveShadow = true;
    scene.add(road);
    const sidewalks = [-7.4, 7.4].map((x) => {
      const walk = new THREE.Mesh(new THREE.BoxGeometry(2, 0.28, 190), new THREE.MeshStandardMaterial({ color: '#d8d1bd', roughness: 1 }));
      walk.position.set(x, 0.05, -77);
      walk.receiveShadow = true;
      scene.add(walk);
      return walk;
    });

    const movers: THREE.Object3D[] = [];
    const dashMaterial = new THREE.MeshBasicMaterial({ color: '#f4d66e' });
    for (const x of [-1.35, 1.35]) for (let z = 12; z > -155; z -= 8) {
      const dash = new THREE.Mesh(new THREE.PlaneGeometry(0.09, 3.1), dashMaterial);
      dash.rotation.x = -Math.PI / 2;
      dash.position.set(x, 0.012, z);
      scene.add(dash);
      movers.push(dash);
    }

    const colors = ['#ef684f', '#f6c85f', '#43aa9d', '#6479c9', '#ef8f54'];
    for (let i = 0; i < 34; i += 1) {
      const h = 4 + (i % 5) * 1.5;
      const side = i % 2 === 0 ? -1 : 1;
      const group = new THREE.Group();
      const building = new THREE.Mesh(new THREE.BoxGeometry(4.8, h, 5.4), new THREE.MeshStandardMaterial({ color: colors[i % colors.length], roughness: 0.9 }));
      building.position.y = h / 2;
      building.castShadow = true;
      group.add(building);
      for (let w = 0; w < 3; w += 1) {
        const windowMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.56, 0.7), new THREE.MeshBasicMaterial({ color: w % 2 ? '#ffe79b' : '#c9efff' }));
        windowMesh.position.set(side < 0 ? 2.405 : -2.405, 1.4 + w * 1.35, 0.7);
        windowMesh.rotation.y = side < 0 ? Math.PI / 2 : -Math.PI / 2;
        group.add(windowMesh);
      }
      group.position.set(side * (10 + (i % 3)), 0, 7 - Math.floor(i / 2) * 10.4);
      scene.add(group);
      movers.push(group);
    }

    const templates: Partial<Record<AssetKind, THREE.Object3D>> = {};
    const entities: Entity[] = [];
    const loader = new GLTFLoader();
    const fbxLoader = new FBXLoader();
    const loadModel = (url: string) => new Promise<LoadedModel>((resolve, reject) => {
      if (url.toLowerCase().endsWith('.fbx')) {
        fbxLoader.load(url, (object) => resolve({ scene: object, animations: object.animations }), undefined, reject);
      } else {
        loader.load(url, (gltf) => resolve({ scene: gltf.scene, animations: gltf.animations }), undefined, reject);
      }
    });
    const savedCharacter = localStorage.getItem('otto-runner-skin');
    const defaultCharacter = characterModels.find((model) => model.id === 1)?.url ?? characterModels[0]?.url ?? '/models/character1.glb';
    const selectedCharacter = savedCharacter && characterModels.some((model) => model.url === savedCharacter) ? savedCharacter : defaultCharacter;
    const characterHeight = selectedCharacter === '/models/character3.glb' ? 2.35 * 0.6 : 2.35;
    const assets: Array<[AssetKind, string, number]> = [
      ['character', selectedCharacter, characterHeight],
      ['coin', '/models/coin.glb', 0.72],
      ['magnet', '/models/daoju1.glb', 1.05],
      ['enemy', '/models/enemy1.glb', 2.15],
      ['enemyAir', '/models/enemy2.glb', 2.75],
      ['explosion', '/models/se1.glb', 2.7],
    ];
    let disposed = false;
    let characterRoot: THREE.Group | null = null;
    let characterVisual: THREE.Object3D | null = null;
    let characterBaseScaleY = 1;
    let characterMode: CharacterMode = 'main';
    const characterVariants: Partial<Record<CharacterMode, THREE.Object3D>> = {};
    const characterMixers: THREE.AnimationMixer[] = [];
    const isCharacter4 = selectedCharacter === '/models/character4.fbx';
    const setCharacterMode = (mode: CharacterMode, restartAnimation = false) => {
      if (!characterRoot) return;
      const next = characterVariants[mode] ?? characterVariants.main;
      if (!next) return;
      Object.values(characterVariants).forEach((variant) => { variant.visible = variant === next; });
      characterVisual = next;
      characterBaseScaleY = next.scale.y;
      if (characterMode !== mode || restartAnimation) {
        const mixer = next.userData.animationMixer as THREE.AnimationMixer | undefined;
        const action = next.userData.animationAction as THREE.AnimationAction | undefined;
        if (mixer && action) { mixer.stopAllAction(); action.reset().play(); }
      }
      characterMode = mode;
    };
    let loadCount = 0;
    assets.forEach(([kind, url, height]) => {
      const urls = kind === 'character' && isCharacter4
        ? [
            ['main', '/models/character4.fbx', 2.35],
            ['walk', '/models/character4-walk.fbx', 2.35],
            ['hurdle', '/models/character4-hurdle.fbx', 2.35],
            ['dog', '/models/character4-dog.glb', 1.35],
          ] as const
        : [['main', url, height]] as const;
      Promise.all(urls.map(async ([mode, modelUrl, modelHeight]) => {
        const loaded = await loadModel(modelUrl);
        return { mode, modelUrl, loaded, visual: fitModel(loaded.scene, modelHeight) };
      })).then((loadedVariants) => {
        if (disposed) return;
        templates[kind] = loadedVariants[0].visual;
        if (kind === 'character') {
          characterRoot = new THREE.Group();
          loadedVariants.forEach(({ mode, modelUrl, loaded, visual }) => {
            visual.rotation.y = Math.PI;
            visual.visible = mode === 'main';
            characterVariants[mode] = visual;
            characterRoot?.add(visual);
            if (loaded.animations[0]) {
              const mixer = new THREE.AnimationMixer(visual);
              // FBX exports often contain root-motion position/scale tracks in
              // authoring units. The runner owns translation and fitted size,
              // so only retain the skeletal rotations from those clips.
              const sourceClip = loaded.animations[0];
              const clip = modelUrl.endsWith('.fbx')
                ? new THREE.AnimationClip(
                    sourceClip.name,
                    sourceClip.duration,
                    sourceClip.tracks.filter((track) => track.name.endsWith('.quaternion')),
                  )
                : sourceClip;
              const action = mixer.clipAction(clip);
              action.play();
              visual.userData.animationMixer = mixer;
              visual.userData.animationAction = action;
              characterMixers.push(mixer);
            }
          });
          setCharacterMode('main');
          characterRoot.position.set(0, 0, PLAYER_Z);
          scene.add(characterRoot);
        }
        loadCount += 1;
        setLoaded(loadCount);
      }).catch(() => {
        loadCount += 1;
        setLoaded(loadCount);
      });
    });

    let currentPhase: Phase = 'menu';
    let lane = 1;
    let targetX = 0;
    let velocityY = 0;
    let playerY = 0;
    let sliding = 0;
    let gameDistance = 0;
    let gameCoins = 0;
    let gameScore = 0;
    let gameLives = 2;
    let invincible = 0;
    let magnet = 0;
    let spawnAt = 15;
    let lastHud = 0;
    let elapsed = 0;
    let lastMoveAt = -Infinity;
    let lastMoveDirection = 1;
    let lastJumpAt = -Infinity;
    let airSpinProgress = 0;
    let airSpinDirection = 1;
    let airSpinActive = false;
    let deathEffect: {
      root: THREE.Group;
      blast: THREE.Object3D;
      blastBaseScale: THREE.Vector3;
      light: THREE.PointLight;
      particles: THREE.Mesh[];
      age: number;
      settled: boolean;
    } | null = null;

    const beginAirSpin = (direction: number) => {
      if (airSpinActive || !characterVisual) return;
      airSpinProgress = 0;
      airSpinDirection = direction;
      airSpinActive = true;
    };

    const clearEntities = () => {
      entities.forEach((entity) => scene.remove(entity.object));
      entities.length = 0;
      if (deathEffect) {
        scene.remove(deathEffect.root);
        deathEffect = null;
      }
    };

    const addEntity = (kind: EntityKind, laneIndex: number, z: number) => {
      const template = templates[kind];
      if (!template) return;
      const holder = new THREE.Group();
      const visual = template.clone(true);
      if (kind === 'coin') visual.rotation.y = Math.PI / 2;
      holder.add(visual);
      const height = kind === 'coin' ? 0.72 : kind === 'enemyAir' ? AIR_ENEMY_BASE_Y : 0;
      holder.position.set(LANES[laneIndex], height, z);
      scene.add(holder);
      entities.push({ kind, lane: laneIndex, object: holder, active: true });
    };

    const spawnPattern = () => {
      const pattern = Math.floor(Math.random() * 7);
      const baseLane = Math.floor(Math.random() * 3);
      const z = -72;
      if (pattern <= 1) {
        for (let i = 0; i < 7; i += 1) addEntity('coin', baseLane, z - i * 2.2);
      } else if (pattern === 2) {
        addEntity('enemy', baseLane, z);
        const safeLane = (baseLane + 1 + Math.floor(Math.random() * 2)) % 3;
        for (let i = 0; i < 5; i += 1) addEntity('coin', safeLane, z - i * 2.2);
      } else if (pattern === 3) {
        addEntity('enemy', baseLane, z);
        addEntity('enemy', (baseLane + 1) % 3, z - 1.2);
        for (let i = 0; i < 5; i += 1) addEntity('coin', (baseLane + 2) % 3, z - i * 2.2);
      } else if (pattern === 4) {
        for (let i = 0; i < 5; i += 1) addEntity('coin', i % 2 ? (baseLane + 1) % 3 : baseLane, z - i * 2.5);
        addEntity('magnet', (baseLane + 2) % 3, z - 4.5);
      } else if (pattern === 5) {
        addEntity('enemyAir', baseLane, z);
        for (let i = 0; i < 5; i += 1) addEntity('coin', baseLane, z - 3.5 - i * 2.2);
      } else {
        addEntity('enemyAir', baseLane, z);
        addEntity('enemy', (baseLane + 1) % 3, z - 1.5);
        for (let i = 0; i < 5; i += 1) addEntity('coin', (baseLane + 2) % 3, z - i * 2.2);
      }
    };

    const start = () => {
      if (!characterRoot || loadCount < assets.length) return;
      clearEntities();
      currentPhase = 'playing';
      lane = 1;
      targetX = 0;
      velocityY = 0;
      playerY = 0;
      sliding = 0;
      gameDistance = 0;
      gameCoins = 0;
      gameScore = 0;
      gameLives = 2;
      invincible = 0;
      magnet = 0;
      spawnAt = 8;
      lastMoveAt = -Infinity;
      lastJumpAt = -Infinity;
      airSpinProgress = 0;
      airSpinActive = false;
      characterRoot.visible = true;
      characterRoot.position.set(0, 0, PLAYER_Z);
      characterRoot.rotation.set(0, 0, 0);
      camera.position.set(0, 5.4, 10.4);
      if (characterVisual) {
        setCharacterMode(isCharacter4 ? 'walk' : 'main', true);
        characterVisual.visible = true;
        characterVisual.rotation.y = Math.PI;
        characterVisual.scale.y = characterBaseScaleY;
      }
      setScore(0);
      setCoins(0);
      setDistance(0);
      setMagnetTime(0);
      setLives(2);
      setPhase('playing');
      ensureMusic();
      playSfx('default');
    };

    const finalizeGameOver = () => {
      currentPhase = 'gameover';
      gameScore = Math.floor(gameDistance * 3 + gameCoins * 25);
      const nextBest = Math.max(Number(localStorage.getItem('otto-runner-best') || 0), gameScore);
      localStorage.setItem('otto-runner-best', String(nextBest));
      setBest(nextBest);
      setScore(gameScore);
      setPhase('gameover');
      if (characterRoot) characterRoot.rotation.z = -0.9;
    };

    const finish = () => {
      if (currentPhase !== 'playing') return;
      finalizeGameOver();
    };

    const explode = () => {
      if (currentPhase !== 'playing' || !characterRoot || !templates.explosion) return;
      currentPhase = 'dying';
      setPhase('dying');
      const root = new THREE.Group();
      root.position.copy(characterRoot.position);
      root.position.y += 0.55;
      const blast = templates.explosion.clone(true);
      const blastBaseScale = blast.scale.clone();
      blast.scale.multiplyScalar(0.08);
      blast.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return;
        child.material = Array.isArray(child.material)
          ? child.material.map((material) => material.clone())
          : child.material.clone();
      });
      forEachMaterial(blast, (material) => {
        material.transparent = true;
        if (material instanceof THREE.MeshStandardMaterial) {
          material.emissive = new THREE.Color('#ff541f');
          material.emissiveIntensity = 2.4;
        }
      });
      root.add(blast);
      const light = new THREE.PointLight('#ff6a21', 22, 18, 2);
      light.position.y = 1;
      root.add(light);
      const particles: THREE.Mesh[] = [];
      const particleGeometry = new THREE.IcosahedronGeometry(0.09, 0);
      for (let i = 0; i < 26; i += 1) {
        const particle = new THREE.Mesh(
          particleGeometry,
          new THREE.MeshBasicMaterial({ color: i % 3 === 0 ? '#fff1a8' : i % 2 ? '#ff9d28' : '#ef3d23', transparent: true }),
        );
        const angle = (i / 26) * Math.PI * 2 + Math.random() * 0.25;
        const speed = 3.5 + Math.random() * 5;
        particle.userData.velocity = new THREE.Vector3(Math.cos(angle) * speed, 2 + Math.random() * 5, Math.sin(angle) * speed * 0.55);
        particles.push(particle);
        root.add(particle);
      }
      scene.add(root);
      characterRoot.visible = false;
      deathEffect = { root, blast, blastBaseScale, light, particles, age: 0, settled: false };
    };

    const takeHit = (damage: number, entity: Entity, useExplosion: boolean) => {
      if (currentPhase !== 'playing' || invincible > 0) return;
      entity.active = false;
      scene.remove(entity.object);
      entity.object.position.z = 20;
      gameLives = Math.max(0, gameLives - damage);
      setLives(gameLives);
      if (gameLives <= 0) {
        playSfx('death');
        if (useExplosion) explode();
        else finish();
      } else {
        playSfx(Math.random() < 0.5 ? 'hurt1' : 'hurt2');
        invincible = 3;
      }
    };

    const move = (direction: number) => {
      if (currentPhase !== 'playing') return;
      const nextLane = THREE.MathUtils.clamp(lane + direction, 0, 2);
      if (nextLane === lane) return;
      lane = nextLane;
      targetX = LANES[lane];
      lastMoveAt = performance.now();
      lastMoveDirection = direction;
      if (playerY > 0.05 || lastMoveAt - lastJumpAt <= 220) beginAirSpin(direction);
    };
    const jump = () => {
      if (currentPhase === 'playing' && playerY < 0.05) {
        velocityY = 10.5;
        lastJumpAt = performance.now();
        if (lastJumpAt - lastMoveAt <= 220) beginAirSpin(lastMoveDirection);
      }
    };
    const slide = () => {
      if (currentPhase === 'playing' && playerY < 0.15) {
        if (sliding <= 0.05) playSfx('hidden');
        sliding = 0.72;
      }
    };
    const pause = () => {
      if (currentPhase !== 'playing') return;
      currentPhase = 'paused';
      setPhase('paused');
      bgMusic.pause();
      playSfx('pause');
    };
    const resume = () => {
      if (currentPhase !== 'paused') return;
      currentPhase = 'playing';
      setPhase('playing');
      ensureMusic();
      playSfx('default');
    };
    apiRef.current = { start, pause, resume, move, jump, slide };

    const keydown = (event: KeyboardEvent) => {
      if (['ArrowLeft', 'a', 'A'].includes(event.key)) move(-1);
      else if (['ArrowRight', 'd', 'D'].includes(event.key)) move(1);
      else if (['ArrowUp', 'w', 'W', ' '].includes(event.key)) jump();
      else if (['ArrowDown', 's', 'S'].includes(event.key)) slide();
      else if (event.key === 'Enter' && (currentPhase === 'menu' || currentPhase === 'gameover')) start();
      else if (event.key === 'Escape' && currentPhase === 'playing') pause();
      else if (event.key === 'Escape' && currentPhase === 'paused') resume();
      if (event.key.startsWith('Arrow') || event.key === ' ') event.preventDefault();
    };
    window.addEventListener('keydown', keydown);

    const clock = new THREE.Clock();
    let frame = 0;
    const render = () => {
      frame = requestAnimationFrame(render);
      const dt = Math.min(clock.getDelta(), 0.034);
      elapsed += dt;
      characterMixers.forEach((mixer) => mixer.update(dt));
      if (currentPhase === 'playing' && characterRoot && characterVisual) {
        const speed = Math.min(16.5 + gameDistance / 85, 28);
        gameDistance += speed * dt;
        spawnAt -= speed * dt;
        if (spawnAt <= 0) {
          spawnPattern();
          spawnAt = Math.max(20, 31 - gameDistance * 0.008);
        }
        characterRoot.position.x = THREE.MathUtils.damp(characterRoot.position.x, targetX, 15, dt);
        characterRoot.rotation.z = THREE.MathUtils.damp(characterRoot.rotation.z, (targetX - characterRoot.position.x) * -0.09, 10, dt);
        velocityY -= 25 * dt;
        playerY = Math.max(0, playerY + velocityY * dt);
        if (playerY === 0) velocityY = 0;
        characterRoot.position.y = playerY + (playerY === 0 ? Math.abs(Math.sin(elapsed * 10)) * 0.06 : 0);
        sliding = Math.max(0, sliding - dt);
        if (isCharacter4) {
          const nextMode: CharacterMode = sliding > 0 ? 'dog' : playerY > 0.05 ? 'hurdle' : 'walk';
          if (nextMode !== characterMode) setCharacterMode(nextMode, nextMode === 'hurdle');
        }
        characterVisual.scale.y = THREE.MathUtils.damp(
          characterVisual.scale.y,
          sliding > 0 ? characterBaseScaleY * 0.62 : characterBaseScaleY,
          18,
          dt,
        );
        characterVisual.rotation.x = THREE.MathUtils.damp(characterVisual.rotation.x, playerY > 0 ? -0.1 : 0, 8, dt);
        if (airSpinActive) {
          airSpinProgress = Math.min(1, airSpinProgress + dt / 0.58);
          characterVisual.rotation.y = Math.PI + airSpinDirection * airSpinProgress * Math.PI * 2;
          if (airSpinProgress >= 1) {
            airSpinActive = false;
            characterVisual.rotation.y = Math.PI;
          }
        }
        magnet = Math.max(0, magnet - dt);
        invincible = Math.max(0, invincible - dt);
        if (currentPhase === 'playing') {
          characterVisual.visible = invincible <= 0 || Math.floor(invincible * 12) % 2 === 0;
        }

        movers.forEach((object) => {
          object.position.z += speed * dt;
          if (object.position.z > 18) object.position.z -= object.userData.isBuilding ? 176 : 168;
        });
        // Building groups use a wider repeat interval than lane dashes.
        movers.slice(42).forEach((object) => { object.userData.isBuilding = true; });

        for (const entity of entities) {
          if (!entity.active) continue;
          entity.object.position.z += speed * dt;
          const dz = entity.object.position.z - PLAYER_Z;
          const dx = entity.object.position.x - characterRoot.position.x;
          if (entity.kind === 'coin') {
            entity.object.rotation.y += dt * 5.5;
            if (magnet > 0 && Math.abs(dz) < 12) {
              entity.object.position.x = THREE.MathUtils.damp(entity.object.position.x, characterRoot.position.x, 7, dt);
              entity.object.position.y = THREE.MathUtils.damp(entity.object.position.y, playerY + 1, 7, dt);
            }
            if (Math.abs(dz) < 1.05 && Math.abs(dx) < (magnet > 0 ? 2.3 : 0.95)) {
              entity.active = false;
              scene.remove(entity.object);
              entity.object.position.z = 20;
              gameCoins += 1;
            }
          } else if (entity.kind === 'magnet') {
            entity.object.rotation.y += dt * 2.8;
            entity.object.position.y = 0.12 + Math.sin(elapsed * 5) * 0.1;
            if (Math.abs(dz) < 1.1 && Math.abs(dx) < 1.05) {
              entity.active = false;
              scene.remove(entity.object);
              entity.object.position.z = 20;
              magnet = 8;
            }
          } else if (entity.kind === 'enemyAir') {
            entity.object.position.y = AIR_ENEMY_BASE_Y + Math.sin(elapsed * 4.5) * 0.08;
            entity.object.rotation.y = Math.sin(elapsed * 2.2) * 0.16;
            if (Math.abs(dz) < 0.95 && Math.abs(dx) < 1.15 && sliding <= 0.08) takeHit(2, entity, true);
          } else if (Math.abs(dz) < 0.9 && Math.abs(dx) < 1.15 && playerY < 1.15) {
            takeHit(1, entity, false);
          }
          if (entity.object.position.z > 15) {
            entity.active = false;
            scene.remove(entity.object);
          }
        }
        for (let i = entities.length - 1; i >= 0; i -= 1) if (!entities[i].active && entities[i].object.position.z > 15) entities.splice(i, 1);
        gameScore = Math.floor(gameDistance * 3 + gameCoins * 25);
        if (elapsed - lastHud > 0.12) {
          lastHud = elapsed;
          setDistance(Math.floor(gameDistance));
          setCoins(gameCoins);
          setScore(gameScore);
          setMagnetTime(Math.ceil(magnet));
        }
        camera.position.x = THREE.MathUtils.damp(camera.position.x, characterRoot.position.x * 0.2, 3, dt);
      }
      if (deathEffect) {
        if (!deathEffect.settled) deathEffect.age += dt;
        const t = Math.min(deathEffect.age / 0.58, 1);
        const easeOut = 1 - Math.pow(1 - t, 3);
        const blastScale = 0.08 + easeOut * 5.5;
        deathEffect.blast.scale.copy(deathEffect.blastBaseScale).multiplyScalar(blastScale);
        deathEffect.light.intensity = 5 + (1 - t) * 20;
        forEachMaterial(deathEffect.blast, (material) => { material.opacity = 1; });
        deathEffect.particles.forEach((particle) => {
          const velocity = particle.userData.velocity as THREE.Vector3;
          if (!deathEffect?.settled) {
            velocity.y -= 12 * dt;
            particle.position.addScaledVector(velocity, dt);
          }
          (particle.material as THREE.MeshBasicMaterial).opacity = 1 - t;
        });
        camera.position.x += (Math.random() - 0.5) * (1 - t) * 0.22;
        camera.position.y += (Math.random() - 0.5) * (1 - t) * 0.16;
        if (t >= 1 && !deathEffect.settled) {
          deathEffect.settled = true;
          finalizeGameOver();
        }
      }
      renderer.render(scene, camera);
    };

    const resize = () => {
      camera.aspect = mount.clientWidth / Math.max(mount.clientHeight, 1);
      camera.updateProjectionMatrix();
      renderer.setSize(mount.clientWidth, mount.clientHeight, false);
    };
    resize();
    window.addEventListener('resize', resize);
    render();
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', resize);
      window.removeEventListener('keydown', keydown);
      clearEntities();
      bgMusic.pause();
      activeSfx.forEach((sound) => { sound.pause(); sound.src = ''; });
      activeSfx.clear();
      audioApiRef.current = null;
      renderer.dispose();
      mount.replaceChildren();
      apiRef.current = null;
    };
  }, []);

  const startGame = useCallback(() => apiRef.current?.start(), []);
  const pauseGame = useCallback(() => apiRef.current?.pause(), []);
  const resumeGame = useCallback(() => apiRef.current?.resume(), []);
  const onTouchStart = (event: React.TouchEvent) => {
    const touch = event.changedTouches[0];
    touchRef.current = { x: touch.clientX, y: touch.clientY };
  };
  const onTouchEnd = (event: React.TouchEvent) => {
    const touch = event.changedTouches[0];
    const dx = touch.clientX - touchRef.current.x;
    const dy = touch.clientY - touchRef.current.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 28) return;
    if (Math.abs(dx) > Math.abs(dy)) apiRef.current?.move(dx > 0 ? 1 : -1);
    else if (dy < 0) apiRef.current?.jump();
    else apiRef.current?.slide();
  };
  const revealAudioControls = () => {
    if (audioHideTimerRef.current) clearTimeout(audioHideTimerRef.current);
    audioHideTimerRef.current = null;
    setAudioControlsOpen(true);
    audioApiRef.current?.ensureMusic();
  };
  const scheduleAudioControlsHide = () => {
    if (audioHideTimerRef.current) clearTimeout(audioHideTimerRef.current);
    audioHideTimerRef.current = setTimeout(() => setAudioControlsOpen(false), 1000);
  };
  const changeMusicVolume = (volume: number) => {
    setMusicVolume(volume);
    audioApiRef.current?.setMusicVolume(volume);
  };
  const changeSfxVolume = (volume: number) => {
    setSfxVolume(volume);
    audioApiRef.current?.setSfxVolume(volume);
  };

  return (
    <main className="game-shell" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <div ref={mountRef} className="game-canvas" aria-label="三维跑酷游戏场景" />
      <header className="brand-bar">
        <div className="game-logo"><span>OTTO</span><strong>冲刺冲</strong></div>
        {phase === 'playing' || phase === 'dying' ? (
          <div className="hud" aria-live="polite">
            <span className="life-stat" aria-label={`剩余 ${lives} 条命`}><b>{Array.from({ length: 2 }, (_, index) => index < lives ? '♥' : '♡').join('')}</b>生命</span>
            <span><b>{score.toLocaleString()}</b>分数</span>
            <span className="coin-stat"><i /> <b>{coins}</b></span>
            <span><b>{distance}m</b>距离</span>
          </div>
        ) : <div className="preview-pill">第二阶段 · 玩法完善</div>}
      </header>

      {phase === 'playing' && magnetTime > 0 && <div className="power-pill">✦ 金币磁铁 <b>{magnetTime}s</b></div>}

      {phase === 'menu' && (
        <section className="start-card">
          <p>三道狂奔 · 金币收集 · 障碍挑战</p>
          <h1>准备好开冲了吗？</h1>
          <button type="button" disabled={loaded < 6} onClick={startGame}>{loaded < 6 ? `正在载入素材 ${loaded}/6…` : '开始游戏'}</button>
          <small>方向键 / WASD · 上滑跳跃 · 下滑下蹲</small>
        </section>
      )}

      {phase === 'gameover' && (
        <section className="start-card result-card">
          <p>本次冲刺结束</p>
          <h1>{score.toLocaleString()} <small>分</small></h1>
          <div className="result-row"><span>金币 <b>{coins}</b></span><span>距离 <b>{distance}m</b></span><span>最高 <b>{best}</b></span></div>
          <button type="button" onClick={startGame}>再冲一次</button>
          <button type="button" className="skin-library-button" onClick={() => { window.location.href = '/skins'; }}>皮肤库</button>
        </section>
      )}

      {phase === 'paused' && (
        <dialog open className="pause-card" aria-labelledby="pause-title">
          <h1 id="pause-title">Pause, pause, pause</h1>
          <div className="pause-actions">
            <button type="button" onClick={resumeGame}>看你爹操作这波</button>
            <button type="button" className="restart-button" onClick={startGame}>这把重开</button>
          </div>
        </dialog>
      )}

      {phase === 'playing' && (
        <div className="mobile-controls" aria-label="游戏控制">
          <button type="button" onClick={() => apiRef.current?.move(-1)} aria-label="向左">←</button>
          <button type="button" onClick={() => apiRef.current?.jump()} aria-label="跳跃">↑</button>
          <button type="button" onClick={() => apiRef.current?.slide()} aria-label="下蹲">↓</button>
          <button type="button" onClick={() => apiRef.current?.move(1)} aria-label="向右">→</button>
        </div>
      )}

      <div className="corner-controls">
        {(phase === 'playing' || phase === 'paused') && (
          <button
            type="button"
            className="round-control pause-trigger"
            aria-label={phase === 'paused' ? '继续游戏' : '暂停游戏'}
            onClick={phase === 'paused' ? resumeGame : pauseGame}
          >
            <span aria-hidden="true">{phase === 'paused' ? '▶' : 'Ⅱ'}</span>
          </button>
        )}
        <div className="audio-control" onMouseEnter={revealAudioControls} onMouseLeave={scheduleAudioControlsHide}>
          <div className={`audio-panel ${audioControlsOpen ? 'is-open' : ''}`} aria-hidden={!audioControlsOpen}>
            <label>
              <span><i>♫</i> 音乐</span>
              <b>{Math.round(musicVolume * 100)}</b>
              <input type="range" min="0" max="1" step="0.01" value={musicVolume} onChange={(event) => changeMusicVolume(Number(event.target.value))} tabIndex={audioControlsOpen ? 0 : -1} />
            </label>
            <label>
              <span><i>♪</i> 音效</span>
              <b>{Math.round(sfxVolume * 100)}</b>
              <input type="range" min="0" max="1" step="0.01" value={sfxVolume} onChange={(event) => changeSfxVolume(Number(event.target.value))} tabIndex={audioControlsOpen ? 0 : -1} />
            </label>
          </div>
          <button
            type="button"
            className="round-control audio-trigger"
            aria-label="调整音乐和音效音量"
            aria-expanded={audioControlsOpen}
            onClick={() => audioControlsOpen ? setAudioControlsOpen(false) : revealAudioControls()}
          >
            <span aria-hidden="true">♫</span>
          </button>
        </div>
      </div>
    </main>
  );
}
