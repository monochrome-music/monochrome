// js/similar-tracks-graph.js
// Interactive node-graph visualization showing relationships between similar tracks/artists
// Uses Canvas for rendering a force-directed graph

export class SimilarTracksGraph {
  constructor(container, options = {}) {
    this.container = typeof container === 'string'
      ? document.getElementById(container) : container;
    this.canvas = null;
    this.ctx = null;
    this.width = options.width || 600;
    this.height = options.height || 400;
    this.nodes = [];
    this.edges = [];
    this.animationId = null;
    this.isDragging = false;
    this.dragNode = null;
    this.mouseX = 0;
    this.mouseY = 0;
    this.centerForce = options.centerForce || 0.01;
    this.repulsion = options.repulsion || 500;
    this.attraction = options.attraction || 0.005;
    this.damping = options.damping || 0.9;
    this.onNodeClick = options.onNodeClick || null;
  }

  init() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    this.canvas.className = 'similar-graph-canvas';
    this.canvas.style.cssText = 'border-radius:8px;background:var(--bg-secondary,#0a0a1a);cursor:grab;';
    this.ctx = this.canvas.getContext('2d');
    if (this.container) this.container.appendChild(this.canvas);
    this._bindEvents();
    return this;
  }

  setData(centerTrack, similarTracks) {
    this.nodes = [];
    this.edges = [];
    // Center node
    const cx = this.width / 2;
    const cy = this.height / 2;
    this.nodes.push({
      id: centerTrack.id || 'center',
      label: centerTrack.title || centerTrack.name,
      artist: centerTrack.artist || '',
      x: cx,
      y: cy,
      vx: 0, vy: 0,
      radius: 20,
      color: 'var(--accent, #e94560)',
      isCenter: true,
      data: centerTrack,
    });
    // Similar nodes
    similarTracks.forEach((track, i) => {
      const angle = (i / similarTracks.length) * Math.PI * 2;
      const dist = 120 + Math.random() * 60;
      this.nodes.push({
        id: track.id || `similar-${i}`,
        label: track.title || track.name,
        artist: track.artist || '',
        x: cx + Math.cos(angle) * dist,
        y: cy + Math.sin(angle) * dist,
        vx: 0, vy: 0,
        radius: 12 + (track.similarity || 0.5) * 8,
        color: this._getColor(track.similarity || 0.5),
        isCenter: false,
        similarity: track.similarity || 0.5,
        data: track,
      });
      this.edges.push({
        source: 'center',
        target: track.id || `similar-${i}`,
        weight: track.similarity || 0.5,
      });
    });
    this.start();
  }

  start() {
    if (this.animationId) cancelAnimationFrame(this.animationId);
    const loop = () => {
      this._simulate();
      this._render();
      this.animationId = requestAnimationFrame(loop);
    };
    loop();
  }

  stop() {
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }

  _simulate() {
    const cx = this.width / 2;
    const cy = this.height / 2;
    // Repulsion between all nodes
    for (let i = 0; i < this.nodes.length; i++) {
      for (let j = i + 1; j < this.nodes.length; j++) {
        const a = this.nodes[i];
        const b = this.nodes[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
        const force = this.repulsion / (dist * dist);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        if (!a.isCenter || !this.isDragging) { a.vx -= fx; a.vy -= fy; }
        if (!b.isCenter || !this.isDragging) { b.vx += fx; b.vy += fy; }
      }
    }
    // Attraction along edges
    for (const edge of this.edges) {
      const a = this.nodes.find(n => n.id === edge.source);
      const b = this.nodes.find(n => n.id === edge.target);
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const force = dist * this.attraction * (edge.weight || 1);
      const fx = (dx / Math.max(dist, 1)) * force;
      const fy = (dy / Math.max(dist, 1)) * force;
      a.vx += fx; a.vy += fy;
      b.vx -= fx; b.vy -= fy;
    }
    // Center gravity
    for (const node of this.nodes) {
      if (this.isDragging && node === this.dragNode) continue;
      node.vx += (cx - node.x) * this.centerForce;
      node.vy += (cy - node.y) * this.centerForce;
      node.vx *= this.damping;
      node.vy *= this.damping;
      node.x += node.vx;
      node.y += node.vy;
      // Bounds
      node.x = Math.max(node.radius, Math.min(this.width - node.radius, node.x));
      node.y = Math.max(node.radius, Math.min(this.height - node.radius, node.y));
    }
  }

  _render() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);
    // Draw edges
    for (const edge of this.edges) {
      const a = this.nodes.find(n => n.id === edge.source);
      const b = this.nodes.find(n => n.id === edge.target);
      if (!a || !b) continue;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = `rgba(233,69,96,${(edge.weight || 0.5) * 0.4})`;
      ctx.lineWidth = 1 + (edge.weight || 0.5) * 2;
      ctx.stroke();
    }
    // Draw nodes
    for (const node of this.nodes) {
      ctx.beginPath();
      ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
      ctx.fillStyle = node.color;
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      ctx.lineWidth = 1;
      ctx.stroke();
      // Label
      ctx.fillStyle = '#fff';
      ctx.font = node.isCenter ? 'bold 11px sans-serif' : '10px sans-serif';
      ctx.textAlign = 'center';
      const label = node.label.length > 18 ? node.label.slice(0, 16) + '...' : node.label;
      ctx.fillText(label, node.x, node.y + node.radius + 14);
      if (node.artist) {
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.font = '9px sans-serif';
        const artist = node.artist.length > 20 ? node.artist.slice(0, 18) + '...' : node.artist;
        ctx.fillText(artist, node.x, node.y + node.radius + 26);
      }
    }
  }

  _getColor(similarity) {
    const r = Math.round(233 * similarity + 50 * (1 - similarity));
    const g = Math.round(69 * similarity + 100 * (1 - similarity));
    const b = Math.round(96 * similarity + 200 * (1 - similarity));
    return `rgb(${r},${g},${b})`;
  }

  _bindEvents() {
    this.canvas.addEventListener('mousedown', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      for (const node of this.nodes) {
        const dx = mx - node.x;
        const dy = my - node.y;
        if (dx * dx + dy * dy < node.radius * node.radius) {
          this.isDragging = true;
          this.dragNode = node;
          this.canvas.style.cursor = 'grabbing';
          break;
        }
      }
    });
    this.canvas.addEventListener('mousemove', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      this.mouseX = e.clientX - rect.left;
      this.mouseY = e.clientY - rect.top;
      if (this.isDragging && this.dragNode) {
        this.dragNode.x = this.mouseX;
        this.dragNode.y = this.mouseY;
        this.dragNode.vx = 0;
        this.dragNode.vy = 0;
      }
    });
    this.canvas.addEventListener('mouseup', () => {
      this.isDragging = false;
      this.dragNode = null;
      this.canvas.style.cursor = 'grab';
    });
    this.canvas.addEventListener('click', (e) => {
      if (this.isDragging) return;
      const rect = this.canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      for (const node of this.nodes) {
        const dx = mx - node.x;
        const dy = my - node.y;
        if (dx * dx + dy * dy < node.radius * node.radius) {
          if (this.onNodeClick) this.onNodeClick(node);
          window.dispatchEvent(new CustomEvent('graph-node-click', { detail: node }));
          break;
        }
      }
    });
  }

  resize(w, h) {
    this.width = w;
    this.height = h;
    if (this.canvas) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  destroy() {
    this.stop();
    if (this.canvas) {
      this.canvas.remove();
      this.canvas = null;
    }
    this.nodes = [];
    this.edges = [];
  }
}
