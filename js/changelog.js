// Changelog Manager - Auto-generate changelog dari GitHub commits
import { SVG_CLOSE } from './icons.js';

const STORAGE_KEY = 'monochrome-last-seen-changelog';
const REPO = 'DaffaAgradhyasto/monochrome';
const COMMITS_API = `https://api.github.com/repos/${REPO}/commits`;

// Parse commit message untuk kategori
function categorizeCommit(message) {
  const msg = message.toLowerCase();
  
  // Skip commit yang tidak relevan
  if (msg.includes('chore: sync upstream') || 
      msg.includes('chore: preserve local workflow') ||
      msg.startsWith('merge ') ||
      msg.startsWith('sync with ')){
    return null;
  }
  
  // Deteksi kategori dari prefix
  if (msg.startsWith('feat:') || msg.startsWith('feat(')) return 'features';
  if (msg.startsWith('fix:') || msg.startsWith('fix(')) return 'fixes';
  if (msg.startsWith('docs:') || msg.startsWith('docs(')) return 'docs';
  if (msg.includes('performance') || msg.includes('perf:')) return 'performance';
  if (msg.includes('refactor')) return 'refactor';
  if (msg.includes('style:') || msg.includes('ui:')) return 'ui';
  
  // Default: improvement
  return 'improvements';
}

// Clean commit message (remove prefix)
function cleanCommitMessage(message) {
  // Ambil baris pertama saja
  const firstLine = message.split('\n')[0];
  
  // Remove conventional commit prefix
  return firstLine
    .replace(/^(feat|fix|docs|style|refactor|perf|test|chore|ui)(\([^)]+\))?:\s*/i, '')
    .trim();
}

// Fetch commits dari GitHub
async function fetchRecentCommits(count = 20) {
  try {
    const response = await fetch(`${COMMITS_API}?per_page=${count}`);
    if (!response.ok) throw new Error('Failed to fetch commits');
    
    const commits = await response.json();
    
    // Filter dan kategorikan
    const categorized = {
      features: [],
      fixes: [],
      improvements: [],
      ui: [],
      performance: [],
      docs: []
    };
    
    commits.forEach(commit => {
      const message = commit.commit.message;
      const author = commit.commit.author.name;
      const date = new Date(commit.commit.author.date);
      const sha = commit.sha.substring(0, 7);
      
      const category = categorizeCommit(message);
      if (!category) return; // Skip
      
      const cleaned = cleanCommitMessage(message);
      
      if (categorized[category]) {
        categorized[category].push({
          message: cleaned,
          author,
          date,
          sha,
          url: commit.html_url
        });
      }
    });
    
    return categorized;
  } catch (error) {
    console.error('Changelog fetch error:', error);
    return null;
  }
}

// Format tanggal relatif (e.g., "2 hours ago")
function timeAgo(date) {
  const seconds = Math.floor((new Date() - date) / 1000);
  
  const intervals = {
    year: 31536000,
    month: 2592000,
    week: 604800,
    day: 86400,
    hour: 3600,
    minute: 60
  };
  
  for (const [unit, secondsInUnit] of Object.entries(intervals)) {
    const interval = Math.floor(seconds / secondsInUnit);
    if (interval >= 1) {
      return `${interval} ${unit}${interval === 1 ? '' : 's'} yang lalu`;
    }
  }
  
  return 'baru saja';
}

// Render changelog HTML
function renderChangelogHTML(commits) {
  const categoryNames = {
    features: '✨ Fitur Baru',
    fixes: '🐛 Perbaikan Bug',
    improvements: '🚀 Peningkatan',
    ui: '🎨 Perubahan UI',
    performance: '⚡ Performa',
    docs: '📝 Dokumentasi'
  };
  
  let html = '<div class="changelog-content">';
  
  // Hitung total commits
  let totalCommits = 0;
  Object.values(commits).forEach(cat => totalCommits += cat.length);
  
  if (totalCommits === 0) {
    html += '<p style="text-align: center; opacity: 0.7; padding: 2rem;">Tidak ada pembaruan terbaru.</p>';
  } else {
    // Render setiap kategori
    Object.entries(commits).forEach(([key, items]) => {
      if (items.length === 0) return;
      
      html += `
        <div class="changelog-category">
          <h3 class="changelog-category-title">${categoryNames[key]}</h3>
          <ul class="changelog-list">
      `;
      
      items.forEach(item => {
        html += `
          <li class="changelog-item">
            <div class="changelog-item-content">
              <span class="changelog-message">${item.message}</span>
              <div class="changelog-meta">
                <span class="changelog-author">${item.author}</span>
                <span class="changelog-sep">•</span>
                <span class="changelog-time">${timeAgo(item.date)}</span>
                <a href="${item.url}" target="_blank" class="changelog-link" title="Lihat di GitHub">
                  #${item.sha}
                </a>
              </div>
            </div>
          </li>
        `;
      });
      
      html += `
          </ul>
        </div>
      `;
    });
  }
  
  html += '</div>';
  return html;
}

// Check apakah user sudah melihat changelog terakhir
function hasSeenLatestChangelog(latestSha) {
  const lastSeen = localStorage.getItem(STORAGE_KEY);
  return lastSeen === latestSha;
}

// Mark changelog sebagai sudah dilihat
function markChangelogAsSeen(latestSha) {
  localStorage.setItem(STORAGE_KEY, latestSha);
}

// Show changelog modal
export async function showChangelogModal(force = false) {
  const modal = document.getElementById('changelog-modal');
  if (!modal) {
    console.warn('Changelog modal not found in DOM');
    return;
  }
  
  const contentEl = document.getElementById('changelog-modal-content');
  const loadingEl = document.getElementById('changelog-loading');
  
  // Show loading
  if (loadingEl) loadingEl.style.display = 'flex';
  if (contentEl) contentEl.innerHTML = '';
  
  // Show modal
  modal.classList.add('active');
  
  // Fetch commits
  const commits = await fetchRecentCommits(20);
  
  // Hide loading
  if (loadingEl) loadingEl.style.display = 'none';
  
  if (!commits) {
    if (contentEl) {
      contentEl.innerHTML = '<p style="text-align: center; opacity: 0.7; padding: 2rem;">Gagal memuat changelog. Coba lagi nanti.</p>';
    }
    return;
  }
  
  // Render changelog
  if (contentEl) {
    contentEl.innerHTML = renderChangelogHTML(commits);
  }
  
  // Get latest commit SHA untuk tracking
  const allCommits = Object.values(commits).flat();
  if (allCommits.length > 0 && !force) {
    const latestSha = allCommits[0].sha;
    markChangelogAsSeen(latestSha);
  }
}

// Auto-show changelog jika ada update baru
export async function autoShowChangelogIfNew() {
  try {
    const response = await fetch(`${COMMITS_API}?per_page=1`);
    if (!response.ok) return;
    
    const commits = await response.json();
    if (commits.length === 0) return;
    
    const latestCommit = commits[0];
    const latestSha = latestCommit.sha.substring(0, 7);
    
    // Skip jika commit dari bot atau sync
    const message = latestCommit.commit.message;
    const category = categorizeCommit(message);
    if (!category) return;
    
    // Check apakah sudah pernah dilihat
    if (!hasSeenLatestChangelog(latestSha)) {
      // Delay sedikit agar tidak mengganggu startup
      setTimeout(() => {
        showChangelogModal();
      }, 3000);
    }
  } catch (error) {
    console.error('Auto changelog check error:', error);
  }
}

// Initialize changelog
export function initChangelog() {
  const modal = document.getElementById('changelog-modal');
  if (!modal) return;
  
  // Close button handler
  const closeBtn = document.getElementById('close-changelog-btn');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      modal.classList.remove('active');
    });
  }
  
  // Click outside to close
  modal.addEventListener('click', (e) => {
    if (e.target === modal || e.target.classList.contains('modal-overlay')) {
      modal.classList.remove('active');
    }
  });
  
  // Auto-check for new updates (optional)
  // autoShowChangelogIfNew();
}

// Expose showChangelog globally for sidebar button
window.showChangelog = showChangelogModal;
