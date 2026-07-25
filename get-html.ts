import puppeteer from 'puppeteer';
import fs from 'fs';

const run = async () => {
    console.log('Launching browser...');
    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const page = await browser.newPage();

    console.log('Navigating to http://localhost:5173 ...');
    await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded', timeout: 5000 }).catch(() => {});

    await new Promise((r) => setTimeout(r, 2000));

    const html = await page.content();
    fs.writeFileSync('page_content.html', html);
    console.log('Saved page content to page_content.html');

    await browser.close();
};

run().catch(console.error);
