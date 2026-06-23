import puppeteer from 'puppeteer';

(async () => {
    try {
        const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
        const page = await browser.newPage();
        
        await page.goto('http://localhost:5173', { waitUntil: 'networkidle0' });
        
        // Let's use evaluate to create an audio element and fetch the stream directly
        const result = await page.evaluate(async () => {
            const url = '/api/decrypt-stream?url=https%3A%2F%2Fmock.com%2Fstream.mp4&key=00112233445566778899aabbccddeeff&codec=flac';
            try {
                // We won't actually fetch a real Amazon stream since the mock URL fails, 
                // but we can check what the ServiceWorker returns if we intercept it.
                // Actually, let's just write the fix into sw-decrypter.js directly.
                return 'ok';
            } catch(e) { return e.toString(); }
        });
        
        await browser.close();
    } catch(e) {}
})();
