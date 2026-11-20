export const nativeTTML = `<?xml version="1.0" encoding="UTF-8"?>
<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xml:lang="fa">
<head><metadata><ttm:agent type="person" xml:id="v1"/></metadata></head>
<body><div><p begin="00:00:01.123" end="00:00:03.987" ttm:agent="v1"><span begin="00:00:01.123" end="00:00:02.456">سلام </span><span begin="00:00:02.500" end="00:00:03.987">World &amp; music</span></p></div></body>
</tt>`;
export const lyricsTrack = {
    id: 'native-ttml-track',
    title: 'Song.Name',
    artist: { name: 'Singer' },
    album: { title: 'Album' },
    isrc: 'USAAA1234567',
    duration: 123,
};
