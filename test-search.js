import { HiFiClient } from './js/HiFi.ts';
async function test() {
    const client = new HiFiClient();
    const res = await client.queryResponse('/search/?q=alskdjfalksjdfld&limit=5');
    const json = await res.json();
    console.log(JSON.stringify(json.data || {}));
}
test();
