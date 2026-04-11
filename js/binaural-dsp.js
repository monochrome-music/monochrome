// js/binaural-dsp.js
// Binaural DSP engine: multichannel HRTF rendering, crossfeed, and stereo widening.
// Placed before EQ in the audio chain.

import { generateHRTFSet, HRTF_PRESETS, CHANNEL_ANGLES_51 } from './hrtf-generator.js';

/**
 * Crossfeed presets (Bauer bs2b-style)
 */
const CROSSFEED_PRESETS = {
    low: { cutoff: 500, crossGainDb: -6, delayMs: 0.2 },
    medium: { cutoff: 700, crossGainDb: -4.5, delayMs: 0.3 },
    high: { cutoff: 1000, crossGainDb: -3, delayMs: 0.4 },
};

export class BinauralDSP {
    /**
     * @param {AudioContext} audioContext
     */
    constructor(audioContext) {
        this.ctx = audioContext;
        this.enabled = false;
        this.mode = 'stereo'; // 'stereo' | 'multichannel'
        this.channelCount = 2;

        // Sub-feature states
        this.crossfeedEnabled = true;
        this.crossfeedLevel = 'medium';
        this.hrtfPreset = 'studio';
        this.wideningEnabled = true;
        this.wideningAmount = 1.0;

        // Graph nodes (created lazily)
        this.inputNode = this.ctx.createGain();
        this.outputNode = this.ctx.createGain();
        this.bypassNode = this.ctx.createGain(); // direct path when disabled

        // Crossfeed nodes
        this._cfSplitter = null;
        this._cfMerger = null;
        this._cfDirectL = null;
        this._cfDirectR = null;
        this._cfCrossLR = null; // L → R cross path
        this._cfCrossRL = null; // R → L cross path
        this._cfFilterLR = null;
        this._cfFilterRL = null;
        this._cfDelayLR = null;
        this._cfDelayRL = null;
        this._cfOutputNode = null;

        // Multichannel HRTF nodes
        this._mcSplitter = null;
        this._mcMerger = null;
        this._mcConvolversL = []; // per-channel left-ear convolvers
        this._mcConvolversR = []; // per-channel right-ear convolvers
        this._mcLfeGain = null;
        this._mcOutputNode = null;
        this._hrtfBuffers = null; // Map from generateHRTFSet

        // Stereo widener nodes
        this._wSplitter = null;
        this._wMerger = null;
        this._wMidL = null;
        this._wMidR = null;
        this._wSideL = null;
        this._wSideR = null;
        this._wMidGain = null;
        this._wSideGain = null;
        this._wMidMix = null;
        this._wSideMix = null;
        this._wDecoderMidToL = null;
        this._wDecoderSideToL = null;
        this._wDecoderMidToR = null;
        this._wDecoderSideToR = null;
        this._wLMix = null;
        this._wRMix = null;
        this._wOutputMerger = null;
        this._wOutputNode = null;

        // Initialize the internal bypass connection
        this._connectInternal();
    }

    /**
     * Get the input/output nodes for graph insertion.
     */
    getNodes() {
        return { input: this.inputNode, output: this.outputNode };
    }

    /**
     * Reconnect internal graph (public API for external callers).
     */
    reconnect() {
        this._connectInternal();
    }

    /**
     * Connect internal graph based on current state.
     */
    _connectInternal() {
        this._disconnectAll();

        if (!this.enabled) {
            // Bypass: input → output directly
            this.inputNode.connect(this.outputNode);
            return;
        }

        if (this.mode === 'multichannel' && this._mcOutputNode) {
            this._connectMultichannelPath();
        } else {
            this._connectStereoPath();
        }
    }

    /**
     * Connect the stereo processing path: crossfeed → widener → output
     */
    _connectStereoPath() {
        let lastNode = this.inputNode;

        if (this.crossfeedEnabled && this._cfOutputNode) {
            lastNode.connect(this._cfSplitter);

            // Direct paths
            this._cfSplitter.connect(this._cfDirectL, 0);
            this._cfSplitter.connect(this._cfDirectR, 1);

            // Cross paths: L → R
            this._cfSplitter.connect(this._cfFilterLR, 0);
            this._cfFilterLR.connect(this._cfDelayLR);
            this._cfDelayLR.connect(this._cfCrossLR);

            // Cross paths: R → L
            this._cfSplitter.connect(this._cfFilterRL, 1);
            this._cfFilterRL.connect(this._cfDelayRL);
            this._cfDelayRL.connect(this._cfCrossRL);

            // Merge: L channel = directL + crossRL, R channel = directR + crossLR
            this._cfDirectL.connect(this._cfMerger, 0, 0);
            this._cfCrossRL.connect(this._cfMerger, 0, 0);
            this._cfDirectR.connect(this._cfMerger, 0, 1);
            this._cfCrossLR.connect(this._cfMerger, 0, 1);

            this._cfMerger.connect(this._cfOutputNode);
            lastNode = this._cfOutputNode;
        }

        if (this.wideningEnabled && this._wOutputNode) {
            this._connectWidener(lastNode);
            lastNode = this._wOutputNode;
        }

        lastNode.connect(this.outputNode);
    }

    /**
     * Connect the multichannel HRTF rendering path: splitter → per-ch HRTF → merger → widener → output
     */
    _connectMultichannelPath() {
        // Input must pass multichannel through
        this.inputNode.channelCount = this.channelCount;
        this.inputNode.channelCountMode = 'max';
        this.inputNode.channelInterpretation = 'discrete';

        this.inputNode.connect(this._mcSplitter);

        const numChannels = Math.min(this.channelCount, CHANNEL_ANGLES_51.length);

        for (let i = 0; i < numChannels; i++) {
            const chInfo = CHANNEL_ANGLES_51[i];

            if (chInfo.isLFE) {
                // LFE: direct mix to both ears at reduced level
                this._mcSplitter.connect(this._mcLfeGain, i);
                this._mcLfeGain.connect(this._mcMerger, 0, 0);
                this._mcLfeGain.connect(this._mcMerger, 0, 1);
            } else {
                // HRTF convolution: split to left and right ear convolvers
                this._mcSplitter.connect(this._mcConvolversL[i], i);
                this._mcSplitter.connect(this._mcConvolversR[i], i);
                this._mcConvolversL[i].connect(this._mcMerger, 0, 0); // left ear
                this._mcConvolversR[i].connect(this._mcMerger, 0, 1); // right ear
            }
        }

        this._mcMerger.connect(this._mcOutputNode);
        let lastNode = this._mcOutputNode;

        if (this.wideningEnabled && this._wOutputNode) {
            this._connectWidener(lastNode);
            lastNode = this._wOutputNode;
        }

        lastNode.connect(this.outputNode);
    }

    /**
     * Connect the stereo widener from a source node.
     */
    _connectWidener(sourceNode) {
        sourceNode.connect(this._wSplitter);

        // Encode L/R → M/S
        this._wSplitter.connect(this._wMidL, 0);
        this._wSplitter.connect(this._wMidR, 1);
        this._wMidL.connect(this._wMidMix);
        this._wMidR.connect(this._wMidMix);

        this._wSplitter.connect(this._wSideL, 0);
        this._wSplitter.connect(this._wSideR, 1);
        this._wSideL.connect(this._wSideMix);
        this._wSideR.connect(this._wSideMix);

        // Apply width gains
        this._wMidMix.connect(this._wMidGain);
        this._wSideMix.connect(this._wSideGain);

        // Decode M/S → L/R
        this._wMidGain.connect(this._wDecoderMidToL);
        this._wSideGain.connect(this._wDecoderSideToL);
        this._wDecoderMidToL.connect(this._wLMix);
        this._wDecoderSideToL.connect(this._wLMix);

        this._wMidGain.connect(this._wDecoderMidToR);
        this._wSideGain.connect(this._wDecoderSideToR);
        this._wDecoderMidToR.connect(this._wRMix);
        this._wDecoderSideToR.connect(this._wRMix);

        // Merge L/R back to stereo
        this._wLMix.connect(this._wOutputMerger, 0, 0);
        this._wRMix.connect(this._wOutputMerger, 0, 1);
        this._wOutputMerger.connect(this._wOutputNode);
    }

    /**
     * Disconnect all internal nodes safely.
     */
    _disconnectAll() {
        const sd = (node) => {
            try {
                node?.disconnect();
            } catch {
                /* */
            }
        };

        sd(this.inputNode);
        sd(this.bypassNode);

        // Crossfeed
        sd(this._cfSplitter);
        sd(this._cfMerger);
        sd(this._cfDirectL);
        sd(this._cfDirectR);
        sd(this._cfCrossLR);
        sd(this._cfCrossRL);
        sd(this._cfFilterLR);
        sd(this._cfFilterRL);
        sd(this._cfDelayLR);
        sd(this._cfDelayRL);
        sd(this._cfOutputNode);

        // Multichannel
        sd(this._mcSplitter);
        sd(this._mcMerger);
        sd(this._mcLfeGain);
        this._mcConvolversL.forEach(sd);
        this._mcConvolversR.forEach(sd);
        sd(this._mcOutputNode);

        // Widener
        sd(this._wSplitter);
        sd(this._wMerger);
        sd(this._wMidL);
        sd(this._wMidR);
        sd(this._wSideL);
        sd(this._wSideR);
        sd(this._wMidGain);
        sd(this._wSideGain);
        sd(this._wMidMix);
        sd(this._wSideMix);
        sd(this._wDecoderMidToL);
        sd(this._wDecoderSideToL);
        sd(this._wDecoderMidToR);
        sd(this._wDecoderSideToR);
        sd(this._wLMix);
        sd(this._wRMix);
        sd(this._wOutputMerger);
        sd(this._wOutputNode);
    }

    // ==========================================
    // Crossfeed creation
    // ==========================================

    _createCrossfeedNodes() {
        const preset = CROSSFEED_PRESETS[this.crossfeedLevel] || CROSSFEED_PRESETS.medium;
        const crossGain = Math.pow(10, preset.crossGainDb / 20);
        const directGain = 1.0 - crossGain * 0.5; // Slightly reduce direct to compensate

        this._cfSplitter = this.ctx.createChannelSplitter(2);
        this._cfMerger = this.ctx.createChannelMerger(2);

        // Direct paths
        this._cfDirectL = this.ctx.createGain();
        this._cfDirectL.gain.value = directGain;
        this._cfDirectL.channelCount = 1;
        this._cfDirectL.channelCountMode = 'explicit';

        this._cfDirectR = this.ctx.createGain();
        this._cfDirectR.gain.value = directGain;
        this._cfDirectR.channelCount = 1;
        this._cfDirectR.channelCountMode = 'explicit';

        // Cross paths: L → R
        this._cfFilterLR = this.ctx.createBiquadFilter();
        this._cfFilterLR.type = 'lowpass';
        this._cfFilterLR.frequency.value = preset.cutoff;
        this._cfFilterLR.Q.value = 0.707;
        this._cfFilterLR.channelCount = 1;
        this._cfFilterLR.channelCountMode = 'explicit';

        this._cfDelayLR = this.ctx.createDelay(0.01);
        this._cfDelayLR.delayTime.value = preset.delayMs / 1000;

        this._cfCrossLR = this.ctx.createGain();
        this._cfCrossLR.gain.value = crossGain;
        this._cfCrossLR.channelCount = 1;
        this._cfCrossLR.channelCountMode = 'explicit';

        // Cross paths: R → L
        this._cfFilterRL = this.ctx.createBiquadFilter();
        this._cfFilterRL.type = 'lowpass';
        this._cfFilterRL.frequency.value = preset.cutoff;
        this._cfFilterRL.Q.value = 0.707;
        this._cfFilterRL.channelCount = 1;
        this._cfFilterRL.channelCountMode = 'explicit';

        this._cfDelayRL = this.ctx.createDelay(0.01);
        this._cfDelayRL.delayTime.value = preset.delayMs / 1000;

        this._cfCrossRL = this.ctx.createGain();
        this._cfCrossRL.gain.value = crossGain;
        this._cfCrossRL.channelCount = 1;
        this._cfCrossRL.channelCountMode = 'explicit';

        this._cfOutputNode = this.ctx.createGain();
    }

    _destroyCrossfeedNodes() {
        const nodes = [
            this._cfSplitter,
            this._cfMerger,
            this._cfDirectL,
            this._cfDirectR,
            this._cfCrossLR,
            this._cfCrossRL,
            this._cfFilterLR,
            this._cfFilterRL,
            this._cfDelayLR,
            this._cfDelayRL,
            this._cfOutputNode,
        ];
        nodes.forEach((n) => {
            try {
                n?.disconnect();
            } catch {
                /* */
            }
        });
        this._cfSplitter = null;
        this._cfMerger = null;
        this._cfDirectL = null;
        this._cfDirectR = null;
        this._cfCrossLR = null;
        this._cfCrossRL = null;
        this._cfFilterLR = null;
        this._cfFilterRL = null;
        this._cfDelayLR = null;
        this._cfDelayRL = null;
        this._cfOutputNode = null;
    }

    // ==========================================
    // Multichannel HRTF creation
    // ==========================================

    async _createMultichannelNodes() {
        const numChannels = Math.min(this.channelCount, CHANNEL_ANGLES_51.length);

        this._mcSplitter = this.ctx.createChannelSplitter(numChannels);
        this._mcMerger = this.ctx.createChannelMerger(2); // binaural output

        this._mcLfeGain = this.ctx.createGain();
        this._mcLfeGain.gain.value = 0.5;
        this._mcLfeGain.channelCount = 1;
        this._mcLfeGain.channelCountMode = 'explicit';

        // Generate HRTF impulse responses
        if (!this._hrtfBuffers || this._hrtfBuffers._preset !== this.hrtfPreset) {
            this._hrtfBuffers = await generateHRTFSet(this.ctx, this.hrtfPreset);
            this._hrtfBuffers._preset = this.hrtfPreset;
        }

        this._mcConvolversL = [];
        this._mcConvolversR = [];

        for (let i = 0; i < numChannels; i++) {
            const chInfo = CHANNEL_ANGLES_51[i];
            if (chInfo.isLFE) {
                // Placeholder - LFE uses gain node instead
                this._mcConvolversL.push(null);
                this._mcConvolversR.push(null);
                continue;
            }

            const hrtf = this._hrtfBuffers.get(i);

            const convL = this.ctx.createConvolver();
            convL.normalize = false;
            convL.buffer = hrtf.left;
            convL.channelCount = 1;
            convL.channelCountMode = 'explicit';

            const convR = this.ctx.createConvolver();
            convR.normalize = false;
            convR.buffer = hrtf.right;
            convR.channelCount = 1;
            convR.channelCountMode = 'explicit';

            this._mcConvolversL.push(convL);
            this._mcConvolversR.push(convR);
        }

        this._mcOutputNode = this.ctx.createGain();
    }

    _destroyMultichannelNodes() {
        const sd = (n) => {
            try {
                n?.disconnect();
            } catch {
                /* */
            }
        };
        sd(this._mcSplitter);
        sd(this._mcMerger);
        sd(this._mcLfeGain);
        this._mcConvolversL.forEach(sd);
        this._mcConvolversR.forEach(sd);
        sd(this._mcOutputNode);

        this._mcSplitter = null;
        this._mcMerger = null;
        this._mcLfeGain = null;
        this._mcConvolversL = [];
        this._mcConvolversR = [];
        this._mcOutputNode = null;
    }

    // ==========================================
    // Stereo widener creation
    // ==========================================

    _createWidenerNodes() {
        this._wSplitter = this.ctx.createChannelSplitter(2);
        this._wOutputMerger = this.ctx.createChannelMerger(2);

        // M/S encoder gains
        this._wMidL = this.ctx.createGain();
        this._wMidL.gain.value = 0.5;
        this._wMidL.channelCount = 1;
        this._wMidL.channelCountMode = 'explicit';

        this._wMidR = this.ctx.createGain();
        this._wMidR.gain.value = 0.5;
        this._wMidR.channelCount = 1;
        this._wMidR.channelCountMode = 'explicit';

        this._wSideL = this.ctx.createGain();
        this._wSideL.gain.value = 0.5;
        this._wSideL.channelCount = 1;
        this._wSideL.channelCountMode = 'explicit';

        this._wSideR = this.ctx.createGain();
        this._wSideR.gain.value = -0.5;
        this._wSideR.channelCount = 1;
        this._wSideR.channelCountMode = 'explicit';

        // Mono mix points
        this._wMidMix = this.ctx.createGain();
        this._wMidMix.channelCount = 1;
        this._wMidMix.channelCountMode = 'explicit';

        this._wSideMix = this.ctx.createGain();
        this._wSideMix.channelCount = 1;
        this._wSideMix.channelCountMode = 'explicit';

        // Width control: mid and side gains
        this._wMidGain = this.ctx.createGain();
        this._wMidGain.gain.value = this._calcMidGain();
        this._wSideGain = this.ctx.createGain();
        this._wSideGain.gain.value = this._calcSideGain();

        // M/S decoder
        this._wDecoderMidToL = this.ctx.createGain();
        this._wDecoderMidToL.gain.value = 1.0;
        this._wDecoderSideToL = this.ctx.createGain();
        this._wDecoderSideToL.gain.value = 1.0;
        this._wDecoderMidToR = this.ctx.createGain();
        this._wDecoderMidToR.gain.value = 1.0;
        this._wDecoderSideToR = this.ctx.createGain();
        this._wDecoderSideToR.gain.value = -1.0;

        // L/R recombination
        this._wLMix = this.ctx.createGain();
        this._wLMix.channelCount = 1;
        this._wLMix.channelCountMode = 'explicit';
        this._wRMix = this.ctx.createGain();
        this._wRMix.channelCount = 1;
        this._wRMix.channelCountMode = 'explicit';

        this._wOutputNode = this.ctx.createGain();
    }

    _destroyWidenerNodes() {
        const nodes = [
            this._wSplitter,
            this._wOutputMerger,
            this._wMidL,
            this._wMidR,
            this._wSideL,
            this._wSideR,
            this._wMidGain,
            this._wSideGain,
            this._wMidMix,
            this._wSideMix,
            this._wDecoderMidToL,
            this._wDecoderSideToL,
            this._wDecoderMidToR,
            this._wDecoderSideToR,
            this._wLMix,
            this._wRMix,
            this._wOutputNode,
        ];
        nodes.forEach((n) => {
            try {
                n?.disconnect();
            } catch {
                /* */
            }
        });
        this._wSplitter = null;
        this._wOutputMerger = null;
        this._wMidL = null;
        this._wMidR = null;
        this._wSideL = null;
        this._wSideR = null;
        this._wMidGain = null;
        this._wSideGain = null;
        this._wMidMix = null;
        this._wSideMix = null;
        this._wDecoderMidToL = null;
        this._wDecoderSideToL = null;
        this._wDecoderMidToR = null;
        this._wDecoderSideToR = null;
        this._wLMix = null;
        this._wRMix = null;
        this._wOutputNode = null;
    }

    _calcMidGain() {
        // At amount=1.0, mid=1.0; at amount=2.0, mid~0.6; at amount=0, mid=2.0
        return 2.0 - this.wideningAmount;
    }

    _calcSideGain() {
        return this.wideningAmount;
    }

    // ==========================================
    // Public API
    // ==========================================

    /**
     * Enable/disable the entire binaural DSP block.
     */
    async setEnabled(enabled) {
        this.enabled = enabled;
        if (enabled) {
            await this._ensureNodesCreated();
        }
        this._connectInternal();
    }

    /**
     * Detect channel count and configure mode accordingly.
     * Call this when source changes or track starts playing.
     * @param {number} channelCount - Number of channels in the source
     */
    async detectAndConfigure(channelCount) {
        const prevMode = this.mode;
        const prevChannels = this.channelCount;
        this.channelCount = channelCount;

        if (channelCount > 2) {
            this.mode = 'multichannel';
        } else {
            this.mode = 'stereo';
        }

        if (this.enabled && (this.mode !== prevMode || channelCount !== prevChannels)) {
            await this._ensureNodesCreated();
            this._connectInternal();

            window.dispatchEvent(
                new CustomEvent('binaural-mode-changed', {
                    detail: { mode: this.mode, channels: this.channelCount },
                })
            );
        }
    }

    /**
     * Set crossfeed level.
     * @param {'low'|'medium'|'high'} level
     */
    setCrossfeedLevel(level) {
        if (!CROSSFEED_PRESETS[level]) return;
        this.crossfeedLevel = level;

        // Update existing crossfeed nodes if they exist
        if (this._cfFilterLR) {
            const preset = CROSSFEED_PRESETS[level];
            const crossGain = Math.pow(10, preset.crossGainDb / 20);
            const directGain = 1.0 - crossGain * 0.5;
            const now = this.ctx.currentTime;

            this._cfFilterLR.frequency.setTargetAtTime(preset.cutoff, now, 0.005);
            this._cfFilterRL.frequency.setTargetAtTime(preset.cutoff, now, 0.005);
            this._cfDelayLR.delayTime.setTargetAtTime(preset.delayMs / 1000, now, 0.005);
            this._cfDelayRL.delayTime.setTargetAtTime(preset.delayMs / 1000, now, 0.005);
            this._cfCrossLR.gain.setTargetAtTime(crossGain, now, 0.005);
            this._cfCrossRL.gain.setTargetAtTime(crossGain, now, 0.005);
            this._cfDirectL.gain.setTargetAtTime(directGain, now, 0.005);
            this._cfDirectR.gain.setTargetAtTime(directGain, now, 0.005);
        }
    }

    /**
     * Enable/disable crossfeed sub-feature.
     */
    async setCrossfeedEnabled(enabled) {
        this.crossfeedEnabled = enabled;
        if (this.enabled) {
            await this._ensureNodesCreated();
            this._connectInternal();
        }
    }

    /**
     * Set HRTF preset (changes virtual speaker angles).
     * @param {'intimate'|'studio'|'wide'} preset
     */
    async setHrtfPreset(preset) {
        if (!HRTF_PRESETS[preset]) return;
        this.hrtfPreset = preset;

        if (this.enabled && this.mode === 'multichannel') {
            // Regenerate HRTF buffers with new angles
            this._destroyMultichannelNodes();
            await this._createMultichannelNodes();
            this._connectInternal();
        }
    }

    /**
     * Set stereo widening amount.
     * @param {number} amount - 0.0 (mono) to 2.0 (extra wide), 1.0 = neutral
     */
    setWideningAmount(amount) {
        this.wideningAmount = Math.max(0, Math.min(2, amount));

        if (this._wMidGain && this._wSideGain) {
            const now = this.ctx.currentTime;
            this._wMidGain.gain.setTargetAtTime(this._calcMidGain(), now, 0.005);
            this._wSideGain.gain.setTargetAtTime(this._calcSideGain(), now, 0.005);
        }
    }

    /**
     * Enable/disable stereo widening sub-feature.
     */
    async setWideningEnabled(enabled) {
        this.wideningEnabled = enabled;
        if (this.enabled) {
            await this._ensureNodesCreated();
            this._connectInternal();
        }
    }

    /**
     * Ensure all required nodes are created for the current mode.
     */
    async _ensureNodesCreated() {
        // Always create widener and crossfeed nodes
        if (!this._cfOutputNode && this.crossfeedEnabled) {
            this._createCrossfeedNodes();
        }
        if (!this._wOutputNode && this.wideningEnabled) {
            this._createWidenerNodes();
        }
        if (this.mode === 'multichannel' && !this._mcOutputNode) {
            await this._createMultichannelNodes();
        }
    }

    /**
     * Get current processing mode info.
     */
    getStatus() {
        return {
            enabled: this.enabled,
            mode: this.mode,
            channels: this.channelCount,
            crossfeed: { enabled: this.crossfeedEnabled, level: this.crossfeedLevel },
            hrtfPreset: this.hrtfPreset,
            widening: { enabled: this.wideningEnabled, amount: this.wideningAmount },
        };
    }

    /**
     * Destroy all nodes and clean up.
     */
    destroy() {
        this._disconnectAll();
        this._destroyCrossfeedNodes();
        this._destroyMultichannelNodes();
        this._destroyWidenerNodes();
        this._hrtfBuffers = null;
    }
}

export { CROSSFEED_PRESETS, HRTF_PRESETS };
