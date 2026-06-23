import puppeteer from 'puppeteer';

(async () => {
    try {
        const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
        const page = await browser.newPage();
        
        // Force Firefox UserAgent
        await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:109.0) Gecko/20100101 Firefox/115.0');
        
        page.on('console', msg => console.log('PAGE LOG:', msg.text()));
        
        const targets = await browser.targets();
        for (const target of targets) {
            if (target.type() === 'service_worker') {
                const worker = await target.worker();
                if (worker) worker.on('console', msg => console.log('SW LOG:', msg.text()));
            }
        }
        
        browser.on('targetcreated', async target => {
            if (target.type() === 'service_worker') {
                const worker = await target.worker();
                if (worker) worker.on('console', msg => console.log('SW LOG:', msg.text()));
            }
        });
        
        await page.goto('http://localhost:5173', { waitUntil: 'networkidle0' });
        
        console.log('Clicking track...');
        await page.evaluate(() => {
            if (window.app && window.app.player) {
                window.app.player.playTrack('12345');
            }
        });
        
        await new Promise(r => setTimeout(r, 8000));
        
        const networkLogs = await page.evaluate(() => {
            return performance.getEntriesByType('resource')
                .filter(r => r.name.includes('/api/decrypt-stream'))
                .map(r => `${r.name} - ${r.duration}ms`);
        });
        console.log('NETWORK:', networkLogs);
        
        const audioState = await page.evaluate(() => {
            const audio = document.querySelector('audio');
            if (!audio) return 'No audio element';
            return {
                src: audio.src,
                readyState: audio.readyState,
                networkState: audio.networkState,
                error: audio.error ? audio.error.code + ' ' + audio.error.message : null,
                currentTime: audio.currentTime,
                paused: audio.paused
            };
        });
        
        console.log('AUDIO STATE:', JSON.stringify(audioState, null, 2));
        
        await browser.close();
    } catch (e) {
        console.log('Error:', e);
        process.exit(1);
    }
})();
