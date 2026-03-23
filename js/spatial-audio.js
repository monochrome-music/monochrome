// js/spatial-audio.js
// Spatial Audio / 3D Audio using Web Audio API HRTF panning
// Provides virtual surround sound effect for headphone listening

export class SpatialAudio {
  constructor(audioContext) {
    this.audioContext = audioContext;
    this.panner = null;
    this.enabled = false;
    this.preset = 'none';
    this.roomSize = 'medium';
    this.convolver = null;
    this._createPanner();
  }

  _createPanner() {
    if (!this.audioContext) return;
    this.panner = this.audioContext.createPanner();
    this.panner.panningModel = 'HRTF';
    this.panner.distanceModel = 'inverse';
    this.panner.refDistance = 1;
    this.panner.maxDistance = 10000;
    this.panner.rolloffFactor = 1;
    this.panner.coneInnerAngle = 360;
    this.panner.coneOuterAngle = 0;
    this.panner.coneOuterGain = 0;
    this.panner.positionX.setValueAtTime(0, this.audioContext.currentTime);
    this.panner.positionY.setValueAtTime(0, this.audioContext.currentTime);
    this.panner.positionZ.setValueAtTime(-1, this.audioContext.currentTime);
  }

  enable() {
    this.enabled = true;
    this._dispatchEvent();
  }

  disable() {
    this.enabled = false;
    this.preset = 'none';
    this._resetPosition();
    this._dispatchEvent();
  }

  toggle() {
    if (this.enabled) this.disable();
    else this.enable();
  }

  getNode() {
    return this.panner;
  }

  setPreset(name) {
    this.preset = name;
    const presets = this._getPresets();
    const p = presets[name];
    if (!p) {
      this._resetPosition();
      return;
    }
    if (this.panner) {
      const t = this.audioContext.currentTime;
      this.panner.positionX.setValueAtTime(p.x, t);
      this.panner.positionY.setValueAtTime(p.y, t);
      this.panner.positionZ.setValueAtTime(p.z, t);
    }
    this._dispatchEvent();
  }

  setPosition(x, y, z) {
    if (!this.panner) return;
    const t = this.audioContext.currentTime;
    this.panner.positionX.setValueAtTime(x, t);
    this.panner.positionY.setValueAtTime(y, t);
    this.panner.positionZ.setValueAtTime(z, t);
    this._dispatchEvent();
  }

  setListenerPosition(x, y, z) {
    const listener = this.audioContext.listener;
    if (listener.positionX) {
      listener.positionX.setValueAtTime(x, this.audioContext.currentTime);
      listener.positionY.setValueAtTime(y, this.audioContext.currentTime);
      listener.positionZ.setValueAtTime(z, this.audioContext.currentTime);
    }
  }

  animateOrbit(speed = 1) {
    if (!this.enabled || !this.panner) return;
    let angle = 0;
    const radius = 2;
    const animate = () => {
      if (!this.enabled) return;
      angle += 0.02 * speed;
      const x = Math.sin(angle) * radius;
      const z = Math.cos(angle) * radius;
      this.setPosition(x, 0, z);
      this._orbitId = requestAnimationFrame(animate);
    };
    this.stopOrbit();
    animate();
  }

  stopOrbit() {
    if (this._orbitId) {
      cancelAnimationFrame(this._orbitId);
      this._orbitId = null;
    }
  }

  _resetPosition() {
    if (!this.panner) return;
    const t = this.audioContext.currentTime;
    this.panner.positionX.setValueAtTime(0, t);
    this.panner.positionY.setValueAtTime(0, t);
    this.panner.positionZ.setValueAtTime(-1, t);
  }

  _getPresets() {
    return {
      'concert-hall': { x: 0, y: 2, z: -5 },
      'intimate': { x: 0, y: 0, z: -0.5 },
      'wide-stage': { x: 0, y: 1, z: -3 },
      'surround': { x: 0, y: 0, z: -2 },
      'behind': { x: 0, y: 0, z: 2 },
      'above': { x: 0, y: 3, z: -1 },
      'left-stage': { x: -3, y: 0, z: -2 },
      'right-stage': { x: 3, y: 0, z: -2 },
    };
  }

  getPresetNames() {
    return Object.keys(this._getPresets());
  }

  getState() {
    return {
      enabled: this.enabled,
      preset: this.preset,
      position: this.panner ? {
        x: this.panner.positionX.value,
        y: this.panner.positionY.value,
        z: this.panner.positionZ.value,
      } : null,
    };
  }

  _dispatchEvent() {
    window.dispatchEvent(new CustomEvent('spatial-audio-update', { detail: this.getState() }));
  }

  destroy() {
    this.stopOrbit();
    this.disable();
    this.panner = null;
  }
}
