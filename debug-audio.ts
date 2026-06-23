import puppeteer from 'puppeteer';

const run = async () => {
  const browser = await puppeteer.launch({
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('BROWSER_CONSOLE:', msg.text()));
  
  page.on('request', req => {
    if (req.url().includes('decrypt-stream') || req.url().includes('/api/')) {
      console.log('API_REQ:', req.method(), req.url());
    }
  });
  page.on('response', response => {
    if (response.url().includes('decrypt-stream') || response.url().includes('/api/')) {
      console.log('API_RES:', response.url(), response.status());
    }
  });
  page.on('requestfailed', request => {
    if (request.url().includes('decrypt-stream') || request.url().includes('/api/')) {
      console.log('API_REQ_FAILED:', request.url(), request.failure()?.errorText);
    }
  });
  
  console.log("Navigating...");
  await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded', timeout: 5000 }).catch(e => console.log('Goto error:', e.message));
  
  console.log("Waiting 10 seconds for app to fully initialize...");
  await new Promise(r => setTimeout(r, 10000));

  console.log("Typing into search bar...");
  await page.evaluate(() => {
     const input = document.getElementById('search-input') as HTMLInputElement;
     if (input) {
         input.value = 'Never Gonna Give You Up';
         input.dispatchEvent(new Event('input', { bubbles: true }));
     }
  });
  await page.focus('#search-input');
  await page.keyboard.press('Enter');

  console.log("Waiting 5 seconds for search results...");
  await new Promise(r => setTimeout(r, 5000));

  console.log("Looking for a track...");
  await page.evaluate(() => {
    const track = document.querySelector('.track-list .track-item, .track-list .row, #search-tracks-container > div');
    if (track) {
       (track as HTMLElement).click();
       console.log("Clicked search result track:", track.className, track.textContent?.substring(0, 30));
    } else {
       console.log("Could not find track. HTML of container:", document.getElementById('search-tracks-container')?.innerHTML?.substring(0, 500));
    }
  });

  console.log("Waiting 10 seconds for audio...");
  await new Promise(r => setTimeout(r, 10000));
  
  console.log("Checking audio elements...");
  const audioInfo = await page.evaluate(() => {
    const audios = Array.from(document.querySelectorAll('audio'));
    return audios.map(a => {
      const error = a.error;
      return {
        src: a.src,
        paused: a.paused,
        currentTime: a.currentTime,
        error: error ? { code: error.code, message: error.message } : null
      };
    });
  });
  console.log("AUDIO_ELEMENTS:", JSON.stringify(audioInfo, null, 2));

  await browser.close();
};
run().catch(console.error);
