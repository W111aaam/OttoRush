'use client';

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import characterModels from 'virtual:character-models';

const SKIN_STORAGE_KEY = 'otto-runner-skin';

function SkinPreview({ url }: { url: string }) {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const mobileGpu = window.matchMedia('(max-width: 768px)').matches;
    let scene: THREE.Scene | null = null;
    let camera: THREE.PerspectiveCamera | null = null;
    let renderer: THREE.WebGLRenderer | null = null;
    let model: THREE.Group | null = null;
    let frame = 0;
    let disposed = false;
    let generation = 0;

    const disposeObject = (object: THREE.Object3D) => {
      object.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return;
        child.geometry.dispose();
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        materials.forEach((material) => {
          Object.values(material).forEach((value) => {
            if (value instanceof THREE.Texture) value.dispose();
          });
          material.dispose();
        });
      });
    };

    const stopPreview = () => {
      generation += 1;
      cancelAnimationFrame(frame);
      if (model) disposeObject(model);
      model = null;
      scene = null;
      camera = null;
      if (renderer) {
        renderer.renderLists.dispose();
        renderer.dispose();
        renderer.forceContextLoss();
      }
      renderer = null;
      mount.replaceChildren();
    };

    const startPreview = () => {
      if (renderer || disposed) return;
      const currentGeneration = ++generation;
      scene = new THREE.Scene();
      camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
      camera.position.set(0, 1.2, 5.4);
      camera.lookAt(0, 1.05, 0);
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: mobileGpu ? 'default' : 'high-performance' });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, mobileGpu ? 1.25 : 1.5));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      mount.appendChild(renderer.domElement);
      scene.add(new THREE.HemisphereLight('#ffffff', '#405168', 2.8));
      const light = new THREE.DirectionalLight('#fff1c7', 3.2);
      light.position.set(3, 5, 4);
      scene.add(light);

      const showModel = (loadedModel: THREE.Object3D) => {
        if (disposed || currentGeneration !== generation || !scene) {
          disposeObject(loadedModel);
          return;
        }
        const pivot = new THREE.Group();
        pivot.add(loadedModel);
        const initialBox = new THREE.Box3().setFromObject(loadedModel);
        const size = initialBox.getSize(new THREE.Vector3());
        loadedModel.scale.setScalar(2.5 / Math.max(size.y, 0.001));
        const box = new THREE.Box3().setFromObject(loadedModel);
        const center = box.getCenter(new THREE.Vector3());
        loadedModel.position.set(-center.x, -box.min.y - 1.2, -center.z);
        model = pivot;
        scene.add(pivot);
      };
      if (url.toLowerCase().endsWith('.fbx')) new FBXLoader().load(url, showModel);
      else new GLTFLoader().load(url, (gltf) => showModel(gltf.scene));

      const resize = () => {
        if (!renderer) return;
        const size = Math.max(mount.clientWidth, 1);
        renderer.setSize(size, size, false);
      };
      const render = () => {
        if (!renderer || !scene || !camera || document.hidden) return;
        frame = requestAnimationFrame(render);
        if (model) model.rotation.y += 0.006;
        renderer.render(scene, camera);
      };
      resize();
      render();
    };

    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) startPreview();
      else stopPreview();
    }, { rootMargin: '120px 0px', threshold: 0.01 });
    observer.observe(mount);
    const resizeObserver = new ResizeObserver(() => {
      if (!renderer) return;
      const size = Math.max(mount.clientWidth, 1);
      renderer.setSize(size, size, false);
    });
    resizeObserver.observe(mount);

    const onVisibilityChange = () => {
      if (document.hidden) cancelAnimationFrame(frame);
      else if (renderer) {
        const renderOnce = () => {
          if (!renderer || !scene || !camera || document.hidden) return;
          frame = requestAnimationFrame(renderOnce);
          if (model) model.rotation.y += 0.006;
          renderer.render(scene, camera);
        };
        renderOnce();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      disposed = true;
      observer.disconnect();
      resizeObserver.disconnect();
      document.removeEventListener('visibilitychange', onVisibilityChange);
      stopPreview();
    };
  }, [url]);

  return <div ref={mountRef} className="skin-preview" aria-hidden="true" />;
}

export default function SkinGallery() {
  const defaultSkin = characterModels.find((model) => model.id === 1)?.url ?? characterModels[0]?.url ?? '/models/character1.glb';
  const [selectedSkin, setSelectedSkin] = useState(defaultSkin);

  useEffect(() => {
    const savedSkin = localStorage.getItem(SKIN_STORAGE_KEY);
    if (savedSkin && characterModels.some((model) => model.url === savedSkin)) setSelectedSkin(savedSkin);
  }, []);

  const selectSkin = (url: string) => {
    setSelectedSkin(url);
    localStorage.setItem(SKIN_STORAGE_KEY, url);
  };

  return (
    <main className="skins-page">
      <button type="button" className="skins-back" onClick={() => { window.location.href = '/'; }} aria-label="返回游戏">← 返回游戏</button>
      <header className="skins-header">
        <p>OTTO 角色衣橱</p>
        <h1>皮肤库</h1>
        <span>选一个顺眼的，接着冲。</span>
      </header>
      <section className="skin-grid" aria-label="可选角色皮肤">
        {characterModels.map((model) => {
          const selected = selectedSkin === model.url;
          return (
            <button
              type="button"
              key={model.url}
              className={`skin-card ${selected ? 'is-selected' : ''}`}
              aria-pressed={selected}
              onClick={() => selectSkin(model.url)}
            >
              <SkinPreview url={model.url} />
              <strong>{model.name}</strong>
              <span>{selected ? '使用中' : '点击选择'}</span>
            </button>
          );
        })}
        <div className="skin-card skin-coming" aria-disabled="true">
          <i>…</i>
          <strong>角色更新中…</strong>
          <span>敬请期待</span>
        </div>
      </section>
    </main>
  );
}
