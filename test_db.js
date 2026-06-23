import { db } from './js/db.js';

async function test() {
    await db.saveSetting('test', 'value123');
    console.log(await db.getSetting('test'));
}
test().catch(console.error);
