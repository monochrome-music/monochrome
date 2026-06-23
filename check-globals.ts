import puppeteer from 'puppeteer';

const run = async () => {
  const browser = await puppeteer.launch({
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const page = await browser.newPage();
  
  console.log("Navigating...");
  await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded', timeout: 5000 }).catch(() => {});
  
  await new Promise(r => setTimeout(r, 4000));

  const windowKeys = await page.evaluate(() => {
    return Object.keys(window).filter(k => !['webkitStorageInfo', 'webkitIndexedDB'].includes(k));
  });
  console.log("Window keys:", windowKeys.filter(k => k.includes('player') || k.includes('api') || k.includes('Monochrome')));

  const searchFormHtml = await page.evaluate(() => document.getElementById('search-form')?.outerHTML);
  console.log("Search form:", searchFormHtml);
  
  await browser.close();
};

run().catch(console.error);
