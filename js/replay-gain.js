function finiteReplayGainNumber(value) {
    if (typeof value === 'string' && value.trim() === '') return null;
    const parsed =
        typeof value === 'number' ? value : typeof value === 'string' ? Number.parseFloat(value) : Number.NaN;
    return Number.isFinite(parsed) ? parsed : null;
}

export function getReplayGainScale(rgValues = null, { mode = 'off', preampDb = 0 } = {}) {
    if (mode === 'off' || !rgValues) return 1;

    const trackGainDb = finiteReplayGainNumber(rgValues.trackReplayGain);
    const albumGainDb = finiteReplayGainNumber(rgValues.albumReplayGain);
    const programLoudness = finiteReplayGainNumber(rgValues.programLoudnessLufs);
    const trackPeak = finiteReplayGainNumber(rgValues.trackPeakAmplitude);
    const albumPeak = finiteReplayGainNumber(rgValues.albumPeakAmplitude);
    let gainDb = 0;
    let peak = 1;

    if (mode === 'album' && albumGainDb !== null && albumGainDb !== 0) {
        gainDb = albumGainDb;
        peak = albumPeak !== null && albumPeak > 0 ? albumPeak : 1;
    } else if (trackGainDb !== null && trackGainDb !== 0) {
        gainDb = trackGainDb;
        peak = trackPeak !== null && trackPeak > 0 ? trackPeak : 1;
    } else if (programLoudness !== null) {
        gainDb = -18 - programLoudness;
        peak = trackPeak !== null && trackPeak > 0 ? trackPeak : 1;
    } else {
        gainDb = trackGainDb || 0;
        peak = trackPeak !== null && trackPeak > 0 ? trackPeak : 1;
    }

    gainDb += finiteReplayGainNumber(preampDb) || 0;
    const scale = Math.pow(10, gainDb / 20);
    return scale * peak > 1 ? 1 / peak : scale;
}
