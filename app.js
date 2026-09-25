 /* =========================================================
    SignBridge v7
    Reliable vision loading + two-hand fusion
 ========================================================= */


/* =========================================================
   DOM HELPER & CONFIGURATION
========================================================= */

const $ = (s, root = document) => root.querySelector(s);

const API =
    localStorage.getItem('signbridge_api') ||
    `${location.protocol}//${location.hostname || 'localhost'}:8000`;

const LOCAL_HISTORY = 'signbridge_history_v5';


/* =========================================================
   DOM REFERENCES
========================================================= */

const video = $('#video');
const overlay = $('#overlay');
const ctx = overlay?.getContext('2d');

const cameraBtn = $('#cameraBtn');
const empty = $('#cameraEmpty');
const camStatus = $('#camStatus');
const camDot = $('#camDot');

const result = $('#result');
const message = $('#message');
const confidence = $('#confidence');
const confidenceBar = $('#confidenceBar');

const speak = $('#speak');
const save = $('#save');
const recognitionState = $('#recognitionState');


/* =========================================================
   GLOBAL STATE
========================================================= */

let stream = null;
let recognizer = null;
let drawingUtils = null;

let raf = 0;
let lastVideoTime = -1;
let lastResult = null;

let frames = 0;
let lastFps = performance.now();

let visionReady = false;

let recording = false;
let recordingFrames = [];
let recordingStartedAt = 0;

let lastSpokenText = '';
let lastSpokenAt = 0;

let trace = [];
let sessionSigns = 0;


/* =========================================================
   DUAL-HAND FUSION VOCABULARY
========================================================= */

const dualMap = {

    // Same + Same

    'Open_Palm|Open_Palm': [
        'DUAL HELLO',
        'Hello — together',
        'twin_palm_hello'
    ],

    'Thumb_Up|Thumb_Up': [
        'DUAL YES',
        'Yes — we agree',
        'twin_thumb_yes'
    ],

    'Thumb_Down|Thumb_Down': [
        'DUAL NO',
        'No — both sides',
        'twin_thumb_no'
    ],

    'Victory|Victory': [
        'PEACE TOGETHER',
        'Peace — together',
        'twin_victory'
    ],

    'ILoveYou|ILoveYou': [
        'LOVE TOGETHER',
        'Love — together',
        'twin_love'
    ],

    'Closed_Fist|Closed_Fist': [
        'STRONG TOGETHER',
        'We stand strong together',
        'twin_fist_strong'
    ],

    'Pointing_Up|Pointing_Up': [
        'ATTENTION PLEASE',
        'Attention, please — together',
        'twin_point_attention'
    ],


    // Closed Fist combos

    'Closed_Fist|Open_Palm': [
        'PAUSE + LISTEN',
        'Pause and listen',
        'fist_palm_pause'
    ],

    'Closed_Fist|Pointing_Up': [
        'WAIT, ONE THING',
        'Wait — one more thing',
        'fist_point_wait'
    ],

    'Closed_Fist|Thumb_Up': [
        'HOLD ON, OKAY',
        'Hold on — but okay',
        'fist_thumbup_holdon'
    ],

    'Closed_Fist|Thumb_Down': [
        'STOP, DISAGREE',
        'Stop — I disagree',
        'fist_thumbdown_stop'
    ],

    'Closed_Fist|Victory': [
        'STAND FOR PEACE',
        'Standing firm for peace',
        'fist_victory_stand'
    ],

    'Closed_Fist|ILoveYou': [
        'PROTECT WITH LOVE',
        'I will protect you with love',
        'fist_iloveyou_protect'
    ],


    // Open Palm combos

    'Open_Palm|Pointing_Up': [
        'LOOK HERE',
        'Hello — look here',
        'palm_point_lookhere'
    ],

    'Open_Palm|Thumb_Up': [
        'HELLO, YES',
        'Hello — and yes',
        'palm_thumbup_hello_yes'
    ],

    'Open_Palm|Thumb_Down': [
        'HELLO, NO',
        'Hello — but no',
        'palm_thumbdown_hello_no'
    ],

    'Open_Palm|Victory': [
        'WELCOME TOGETHER',
        'Welcome — come in',
        'victory_palm_welcome'
    ],

    'ILoveYou|Open_Palm': [
        'I AM WITH YOU',
        'I am with you',
        'palm_iloveyou'
    ],


    // Pointing Up combos

    'Pointing_Up|Thumb_Up': [
        'NOTE THIS, YES',
        'Note this — yes',
        'point_thumbup_note_yes'
    ],

    'Pointing_Up|Thumb_Down': [
        'NOTE THIS, NO',
        'Note this — no',
        'point_thumbdown_note_no'
    ],

    'Pointing_Up|Victory': [
        'POINT FOR PEACE',
        'One important point for peace',
        'point_victory_point_peace'
    ],

    'ILoveYou|Pointing_Up': [
        'IMPORTANT, LOVE',
        'This matters — with love',
        'point_iloveyou_important'
    ],


    // Thumb Up / Thumb Down combos

    'Thumb_Down|Thumb_Up': [
        'MIXED FEELINGS',
        'Mixed feelings — yes and no',
        'thumbup_thumbdown_mixed'
    ],

    'Thumb_Up|Victory': [
        'YES TO PEACE',
        'Yes — to peace',
        'thumbup_victory_yes_peace'
    ],

    'ILoveYou|Thumb_Up': [
        'YES WITH LOVE',
        'Yes — with love',
        'thumbup_iloveyou_yes_love'
    ],

    'Thumb_Down|Victory': [
        'NO MORE FIGHTING',
        'No — let’s have peace instead',
        'thumbdown_victory_no_fighting'
    ],

    'ILoveYou|Thumb_Down': [
        'NO, BUT LOVE',
        'No — but still with love',
        'thumbdown_iloveyou_no_love'
    ],


    // Victory / I Love You

    'ILoveYou|Victory': [
        'PEACE AND LOVE',
        'Peace and love',
        'victory_iloveyou_peace_love'
    ]
};


/* =========================================================
   BASIC UI HELPERS
========================================================= */

function toast(text) {

    const t = $('#toast');

    if (!t) return;

    t.textContent = text;

    t.classList.add('show');

    clearTimeout(window.__toast);

    window.__toast = setTimeout(() => {
        t.classList.remove('show');
    }, 2200);
}


function setHero(label = 'READY', pct = 0) {

    $('#heroGesture').textContent = label;

    $('#heroMeter').style.width = `${pct}%`;

    $('#heroConfidence').textContent =
        pct
            ? `${pct}% confidence`
            : 'Waiting for camera';
}


/* =========================================================
   SPEECH SYNTHESIS
========================================================= */

function speakRealtime(text) {

    if (!text) return;

    if (!('speechSynthesis' in window)) return;

    const now = Date.now();

    // Prevent repeating the same sentence continuously
    if (
        text === lastSpokenText &&
        now - lastSpokenAt < 2500
    ) {
        return;
    }

    lastSpokenText = text;
    lastSpokenAt = now;

    speechSynthesis.cancel();

    const utterance =
        new SpeechSynthesisUtterance(text);

    utterance.rate = 0.95;
    utterance.pitch = 1;
    utterance.volume = 1;

    speechSynthesis.speak(utterance);
}


function speakMessage() {

    if (!lastResult) {
        toast('No message to speak yet.');
        return;
    }

    if (!('speechSynthesis' in window)) {
        toast('Speech synthesis is unavailable.');
        return;
    }

    speechSynthesis.cancel();

    speechSynthesis.speak(
        new SpeechSynthesisUtterance(lastResult.text)
    );

    toast('Speaking message');
}


/* =========================================================
   RECOGNITION UI
========================================================= */

function setRecognition(
    label,
    text,
    pct,
    mode = 'DUAL-HAND FUSION',
    hands = 2
) {

    result.textContent = label;

    message.textContent = text;

    $('#recognitionMode').textContent = mode;

    const n = Math.round(pct * 100);

    confidence.textContent = `${n}%`;

    confidenceBar.style.width = `${n}%`;

    speak.disabled = !text;
    save.disabled = !text;

    lastResult = {
        label,
        text,
        confidence: pct,
        hands
    };

    if (pct >= 0.70) {
        speakRealtime(text);
    }

    setHero(label, n);

    updateDNA(pct, hands);
}


function dualKey(a, b) {

    return [a, b]
        .sort()
        .join('|');
}


/* =========================================================
   HAND LANDMARK CONNECTIONS
========================================================= */

const HAND_CONNECTIONS = [

    [0, 1],
    [1, 2],
    [2, 3],
    [3, 4],

    [0, 5],
    [5, 6],
    [6, 7],
    [7, 8],

    [5, 9],
    [9, 10],
    [10, 11],
    [11, 12],

    [9, 13],
    [13, 14],
    [14, 15],
    [15, 16],

    [13, 17],
    [17, 18],
    [18, 19],
    [19, 20],

    [0, 17]
];


/* =========================================================
   DRAW HAND LANDMARKS
========================================================= */

function drawResults(res) {

    if (!ctx || !video) return;

    overlay.width = video.videoWidth || 640;
    overlay.height = video.videoHeight || 480;

    ctx.clearRect(
        0,
        0,
        overlay.width,
        overlay.height
    );

    if (!res?.landmarks?.length) return;


    res.landmarks.forEach((hand, hi) => {

        ctx.lineWidth = 3;

        ctx.strokeStyle =
            hi === 0
                ? '#91a8ff'
                : '#ff8fd8';


        for (const [a, b] of HAND_CONNECTIONS) {

            const p = hand[a];
            const q = hand[b];

            if (!p || !q) continue;

            ctx.beginPath();

            ctx.moveTo(
                p.x * overlay.width,
                p.y * overlay.height
            );

            ctx.lineTo(
                q.x * overlay.width,
                q.y * overlay.height
            );

            ctx.stroke();
        }


        ctx.fillStyle =
            hi === 0
                ? '#ffffff'
                : '#ffd7f1';


        hand.forEach(p => {

            ctx.beginPath();

            ctx.arc(
                p.x * overlay.width,
                p.y * overlay.height,
                4,
                0,
                Math.PI * 2
            );

            ctx.fill();
        });

    });
}


/* =========================================================
   MEDIAPIPE VISION LOADING
========================================================= */

async function loadVision() {

    if (visionReady) return true;

    $('#modelStatus').textContent =
        'MODEL: LOADING';


    const cdns = [

        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/vision_bundle.mjs',

        'https://unpkg.com/@mediapipe/tasks-vision@latest/vision_bundle.mjs'
    ];


    const wasms = [

        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm',

        'https://unpkg.com/@mediapipe/tasks-vision@latest/wasm'
    ];


    const model =
        'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task';


    let lastError = null;


    for (const cdn of cdns) {

        try {

            const mod = await import(cdn);


            for (const wasm of wasms) {

                try {

                    const vision =
                        await mod.FilesetResolver.forVisionTasks(
                            wasm
                        );


                    const options = {

                        baseOptions: {
                            modelAssetPath: model,
                            delegate: 'GPU'
                        },

                        runningMode: 'VIDEO',

                        numHands: 2,

                        minHandDetectionConfidence: 0.50,

                        minHandPresenceConfidence: 0.50,

                        minTrackingConfidence: 0.50
                    };


                    try {

                        recognizer =
                            await mod.GestureRecognizer.createFromOptions(
                                vision,
                                options
                            );

                    } catch (gpuError) {

                        options.baseOptions.delegate = 'CPU';

                        recognizer =
                            await mod.GestureRecognizer.createFromOptions(
                                vision,
                                options
                            );
                    }


                    visionReady = true;

                    $('#modelStatus').textContent =
                        'MODEL: READY';

                    $('#engineState').textContent =
                        'ACTIVE';

                    return true;

                } catch (e) {

                    lastError = e;
                }
            }

        } catch (e) {

            lastError = e;
        }
    }


    console.error(
        'SignBridge vision load failed:',
        lastError
    );


    $('#modelStatus').textContent =
        'VISION UNAVAILABLE';

    $('#engineState').textContent =
        'VISION OFFLINE';

    toast(
        'Vision unavailable. Check internet, then reload Chrome.'
    );

    return false;
}


/* =========================================================
   CAMERA CONTROL
========================================================= */

async function startCamera() {

    if (stream) {

        stopCamera();

        return;
    }


    if (!navigator.mediaDevices?.getUserMedia) {

        toast(
            'Camera API unavailable. Open http://localhost:8080 in Chrome.'
        );

        return;
    }


    try {

        const visionPromise = loadVision();


        stream =
            await navigator.mediaDevices.getUserMedia({

                video: {
                    facingMode: 'user',

                    width: {
                        ideal: 1280
                    },

                    height: {
                        ideal: 720
                    }
                },

                audio: false
            });


        video.srcObject = stream;

        await video.play();


        empty.hidden = true;

        camStatus.textContent = 'LIVE';

        camDot.classList.add('live');

        cameraBtn.textContent =
            'Disable camera';


        const visionOK =
            await visionPromise;


        $('#engineState').textContent =
            visionOK
                ? 'ACTIVE'
                : 'VISION OFFLINE';


        if (visionOK) {

            lastVideoTime = -1;

            loop();

        } else {

            recognitionState.textContent =
                'VISION UNAVAILABLE';

            $('#recognitionMode').textContent =
                'RELOAD AFTER INTERNET IS AVAILABLE';
        }


    } catch (e) {

        console.error(
            'Camera start error:',
            e
        );

        camStatus.textContent =
            'BLOCKED';

        $('#modelStatus').textContent =
            'CAMERA ERROR';

        toast(
            'Camera permission was denied or unavailable.'
        );
    }
}


function stopCamera() {

    cancelAnimationFrame(raf);


    if (stream) {

        stream
            .getTracks()
            .forEach(t => t.stop());
    }


    stream = null;

    video.srcObject = null;


    if (ctx) {

        ctx.clearRect(
            0,
            0,
            overlay.width,
            overlay.height
        );
    }


    empty.hidden = false;

    camStatus.textContent =
        'OFFLINE';

    camDot.classList.remove('live');

    cameraBtn.textContent =
        'Enable camera';

    $('#engineState').textContent =
        'STANDBY';

    $('#hands').textContent =
        '0 HANDS';

    setHero();
}


/* =========================================================
   RECORDING
========================================================= */

function captureRecordingFrame(res) {

    if (!recording) return;

    if (!res?.landmarks?.length) return;


    const now = performance.now();


    // Capture roughly every 100ms
    if (
        recordingFrames.length &&
        now -
            recordingFrames[
                recordingFrames.length - 1
            ].time < 100
    ) {
        return;
    }


    recordingFrames.push({

        time: Math.round(
            now - recordingStartedAt
        ),

        hands: res.landmarks.map(hand =>
            hand.map(p => ({

                x: Number(
                    p.x.toFixed(5)
                ),

                y: Number(
                    p.y.toFixed(5)
                ),

                z: Number(
                    p.z.toFixed(5)
                )
            }))
        )
    });


    $('#recordFrames').textContent =
        recordingFrames.length;
}


async function startRecording() {

    const label =
        $('#recordLabel')?.value.trim();


    if (!label) {

        toast(
            'Enter a sign label first'
        );

        return;
    }


    if (!stream) {

        toast(
            'Enable camera first'
        );

        return;
    }


    recording = true;

    recordingFrames = [];

    recordingStartedAt =
        performance.now();


    $('#recordStart').disabled = true;

    $('#recordStop').disabled = false;


    $('#recordStatus').textContent =
        `RECORDING: ${label.toUpperCase()}`;

    $('#recordFrames').textContent =
        '0';
}


async function stopRecording() {

    if (!recording) return;


    recording = false;


    $('#recordStart').disabled = false;

    $('#recordStop').disabled = true;


    const label =
        $('#recordLabel').value.trim();


    if (recordingFrames.length < 5) {

        $('#recordStatus').textContent =
            'TOO FEW FRAMES';

        toast(
            'Record for a little longer'
        );

        return;
    }


    const body = {

        label,

        landmarks:
            JSON.stringify(recordingFrames),

        frame_count:
            recordingFrames.length
    };


    const data =
        await api(
            '/api/v1/recordings',
            {
                method: 'POST',
                body: JSON.stringify(body)
            }
        );


    if (data) {

        $('#recordStatus').textContent =
            `SAVED: ${label.toUpperCase()}`;

        toast(
            'Hand sign recording saved'
        );

    } else {

        $('#recordStatus').textContent =
            'SAVE FAILED';
    }
}


async function exportRecordings() {

    const data =
        await api(
            '/api/v1/recordings?limit=500'
        );


    if (!data?.items?.length) {

        toast(
            'No recordings to export'
        );

        return;
    }


    const blob =
        new Blob(
            [
                JSON.stringify(
                    data.items,
                    null,
                    2
                )
            ],
            {
                type: 'application/json'
            }
        );


    const url =
        URL.createObjectURL(blob);


    const a =
        document.createElement('a');

    a.href = url;

    a.download =
        `signbridge-recordings-${Date.now()}.json`;

    a.click();


    URL.revokeObjectURL(url);


    toast(
        'Recordings exported'
    );
}


async function importRecordings(event) {

    const file =
        event.target.files?.[0];


    if (!file) return;


    try {

        const text =
            await file.text();

        const records =
            JSON.parse(text);


        if (!Array.isArray(records)) {

            throw new Error(
                'Invalid recording file'
            );
        }


        let count = 0;


        for (const record of records) {

            const data =
                await api(
                    '/api/v1/recordings',
                    {
                        method: 'POST',

                        body: JSON.stringify({

                            label: record.label,

                            landmarks:
                                record.landmarks,

                            frame_count:
                                record.frame_count || 0
                        })
                    }
                );


            if (data) count++;
        }


        toast(
            `${count} recordings imported`
        );


    } catch (error) {

        console.error(error);

        toast(
            'Import failed'
        );


    } finally {

        event.target.value = '';
    }
}


/* =========================================================
   MAIN VIDEO LOOP
========================================================= */

function loop() {

    if (!stream || !recognizer) return;


    const now =
        performance.now();


    if (
        video.readyState >= 2 &&
        video.currentTime !== lastVideoTime
    ) {

        lastVideoTime =
            video.currentTime;


        try {

            const res =
                recognizer.recognizeForVideo(
                    video,
                    now
                );


            drawResults(res);

            pushTrace(res);

            captureRecordingFrame(res);

            processRecognition(res);


            frames++;


            if (now - lastFps > 1000) {

                $('#fps').textContent =
                    `${frames} FPS`;

                frames = 0;

                lastFps = now;
            }


        } catch (e) {

            console.error(
                'SignBridge recognition error:',
                e
            );

            $('#modelStatus').textContent =
                'ENGINE ERROR';

            recognitionState.textContent =
                'ENGINE RETRY';
        }
    }


    raf =
        requestAnimationFrame(loop);
}


/* =========================================================
   RECOGNITION PROCESSING
========================================================= */

function processRecognition(res) {

    const count =
        res?.landmarks?.length || 0;


    $('#hands').textContent =
        `${count} HAND${count === 1 ? '' : 'S'}`;


    const tops =
        (res?.gestures || [])
            .map(g => g?.[0])
            .filter(Boolean);


    if (count >= 2) {

        const names = [

            tops[0]?.categoryName ||
                'Unknown',

            tops[1]?.categoryName ||
                'Unknown'
        ];


        const scores = [

            tops[0]?.score || 0,

            tops[1]?.score || 0
        ];


        const score =
            Math.min(...scores);


        updateTwin(
            names[0],
            names[1]
        );


        const fusion =
            dualMap[
                dualKey(
                    names[0],
                    names[1]
                )
            ];


        if (fusion) {

            const [
                label,
                text,
                id
            ] = fusion;


            setRecognition(
                label,
                text,
                score,
                'DUAL-HAND FUSION',
                2
            );


            lastResult.fusion_id =
                id;


            recognitionState.textContent =
                score >= 0.65
                    ? 'FUSION LOCKED'
                    : 'LOW CONFIDENCE';


        } else {

            const label =
                `${names[0].replaceAll('_', ' ')} + ${names[1].replaceAll('_', ' ')}`;


            const text =
                `Two-hand gesture detected: ${label}`;


            setRecognition(
                'CUSTOM FUSION',
                text,
                Math.max(0.5, score),
                'DUAL-HAND FUSION',
                2
            );


            lastResult.fusion_id =
                `dynamic_${dualKey(
                    names[0],
                    names[1]
                ).replaceAll(' ', '_')}`;


            recognitionState.textContent =
                score >= 0.65
                    ? 'FUSION DETECTED'
                    : 'TWO HANDS DETECTED';
        }


        $('#fusionLeft').textContent =
            names[0].replaceAll('_', ' ');

        $('#fusionRight').textContent =
            names[1].replaceAll('_', ' ');


    } else if (count === 1) {

        recognitionState.textContent =
            'ONE HAND — WAITING FOR SECOND';

        setHero(
            'ADD SECOND HAND',
            0
        );

        $('#recognitionMode').textContent =
            'WAITING FOR 2 HANDS';


    } else {

        recognitionState.textContent =
            'SEARCHING';

        setHero(
            'SEARCHING',
            0
        );

        $('#recognitionMode').textContent =
            'WAITING FOR 2 HANDS';
    }
}


/* =========================================================
   API
========================================================= */

async function api(path, opts = {}) {

    try {

        const r =
            await fetch(
                API + path,
                {
                    headers: {
                        'Content-Type':
                            'application/json',

                        ...(opts.headers || {})
                    },

                    ...opts
                }
            );


        if (!r.ok) {
            throw Error();
        }


        return await r.json();


    } catch {

        return null;
    }
}


/* =========================================================
   LOCAL HISTORY
========================================================= */

function getLocalHistory() {

    try {

        return JSON.parse(
            localStorage.getItem(
                LOCAL_HISTORY
            ) || '[]'
        );

    } catch {

        return [];
    }
}


function setLocalHistory(x) {

    localStorage.setItem(
        LOCAL_HISTORY,
        JSON.stringify(x)
    );
}


/* =========================================================
   HTML ESCAPING
========================================================= */

function esc(v) {

    return String(v).replace(
        /[&<>'"]/g,
        c => ({

            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            "'": '&#39;',
            '"': '&quot;'

        }[c])
    );
}


/* =========================================================
   HISTORY RENDERING
========================================================= */

function renderHistory(items) {

    const box =
        $('#historyRows');


    if (!box) return;


    if (!items.length) {

        box.innerHTML =
            '<div class="empty">No saved messages yet.</div>';

        return;
    }


    box.innerHTML =
        items
            .map(
                x => `
                    <div class="history-row">

                        <span>
                            ${esc(x.gesture)}
                        </span>

                        <span>
                            ${esc(x.text)}
                        </span>

                        <b>
                            ${Math.round(
                                (x.confidence || 0) * 100
                            )}%
                        </b>

                        <time>
                            ${new Date(
                                x.created_at || Date.now()
                            ).toLocaleString()}
                        </time>

                    </div>
                `
            )
            .join('');
}


/* =========================================================
   SAVE MESSAGE
========================================================= */

async function saveMessage() {

    if (!lastResult) {

        toast(
            'Recognize a two-hand sign first.'
        );

        return;
    }


    const body = {

        gesture:
            lastResult.label,

        text:
            lastResult.text,

        confidence:
            lastResult.confidence,

        source:
            'camera',

        hands:
            lastResult.hands || 2,

        fusion_id:
            lastResult.fusion_id || null
    };


    const data =
        await api(
            '/api/v1/messages',
            {
                method: 'POST',
                body: JSON.stringify(body)
            }
        );


    const items =
        getLocalHistory();


    items.unshift({

        ...body,

        created_at:
            new Date().toISOString()
    });


    setLocalHistory(
        items.slice(0, 50)
    );


    renderHistory(
        items.slice(0, 50)
    );


    save.textContent =
        data
            ? '✓ Saved'
            : '✓ Saved locally';


    toast(
        data
            ? 'Saved to backend'
            : 'Saved on this device'
    );


    setTimeout(() => {

        save.textContent =
            '＋ Save to history';

    }, 1200);
}


/* =========================================================
   LOAD HISTORY
========================================================= */

async function loadHistory() {

    const data =
        await api(
            '/api/v1/messages?limit=50'
        );


    renderHistory(
        data?.items ||
        getLocalHistory()
    );
}


/* =========================================================
   CLEAR HISTORY
========================================================= */

async function clearHistory() {

    await api(
        '/api/v1/messages',
        {
            method: 'DELETE'
        }
    );


    setLocalHistory([]);

    renderHistory([]);

    toast(
        'History cleared'
    );
}


/* =========================================================
   SCROLL TO LIVE
========================================================= */

function scrollLive() {

    document
        .querySelector('#live')
        ?.scrollIntoView({
            behavior: 'smooth',
            block: 'start'
        });


    setTimeout(
        () => cameraBtn?.focus(),
        450
    );
}


/* =========================================================
   DEMO MESSAGE
========================================================= */

function demoMessage(label, text) {

    setRecognition(
        label,
        text,
        0.96,
        'DEMO / DUAL-HAND FUSION',
        2
    );


    $('#fusionLeft').textContent =
        'DEMO LEFT';

    $('#fusionRight').textContent =
        'DEMO RIGHT';


    recognitionState.textContent =
        'DEMO READY';


    toast(
        'Preview loaded — enable camera for live AI'
    );
}


/* =========================================================
   INTELLIGENCE / SIGN DNA
========================================================= */

function clamp(n) {

    return Math.max(
        0,
        Math.min(100, n)
    );
}


function updateDNA(
    score = 0,
    hands = 0
) {

    const base =
        clamp(
            Math.round(score * 100)
        );


    $('#dnaScore').textContent =
        base;


    $('#dnaShape').style.width =
        clamp(
            base + (hands === 2 ? 6 : 0)
        ) + '%';


    $('#dnaSpace').style.width =
        clamp(
            base - 4 +
            (hands === 2 ? 12 : 0)
        ) + '%';


    $('#dnaMotion').style.width =
        clamp(
            base * 0.72 + 28
        ) + '%';


    $('#dnaTime').style.width =
        clamp(
            base * 0.65 + 35
        ) + '%';


    $('#dnaStatus').textContent =
        hands === 2
            ? (
                base >= 65
                    ? 'FUSION'
                    : 'AMBIGUOUS'
            )
            : 'WAITING';


    $('#doubtPct').textContent =
        `${base}%`;


    $('#doubtState').textContent =
        base >= 70
            ? 'CONFIDENT'
            : base >= 50
                ? 'GUARDED'
                : 'UNCERTAIN';


    $('#feedbackBtn').disabled =
        base < 50 || !lastResult;


    $('#repeatSign').disabled =
        base >= 70 || !stream;
}


/* =========================================================
   COMMUNICATION TWIN
========================================================= */

function updateTwin(
    left = '—',
    right = '—'
) {

    if (
        left === '—' ||
        right === '—'
    ) {
        return;
    }


    $('#twinLeft').textContent =
        left.slice(0, 1);


    $('#twinRight').textContent =
        right.slice(0, 1);


    sessionSigns++;


    $('#twinState').textContent =
        `SESSION ${String(sessionSigns).padStart(2, '0')}`;


    $('#twinText').textContent =
        `Style profile updated from ${sessionSigns} observed fusion${sessionSigns === 1 ? '' : 's'}`;
}


/* =========================================================
   SIGN REPLAY / TRACE
========================================================= */

function pushTrace(res) {

    const rc =
        $('#replayCanvas')
            ?.getContext('2d');


    if (
        !rc ||
        !res?.landmarks?.length
    ) {
        return;
    }


    const pts = [];


    res.landmarks.forEach(
        h =>
            h.forEach(
                p =>
                    pts.push(p)
            )
    );


    const avg =
        pts.reduce(
            (a, p) => ({
                x: a.x + p.x,
                y: a.y + p.y
            }),
            {
                x: 0,
                y: 0
            }
        );


    avg.x /=
        pts.length || 1;

    avg.y /=
        pts.length || 1;


    trace.push(avg);


    if (trace.length > 90) {
        trace.shift();
    }


    $('#tracePoints').textContent =
        trace.length;


    rc.clearRect(
        0,
        0,
        900,
        260
    );


    rc.beginPath();


    trace.forEach(
        (p, i) => {

            const x =
                p.x * 900;

            const y =
                p.y * 260;


            if (i) {

                rc.lineTo(
                    x,
                    y
                );

            } else {

                rc.moveTo(
                    x,
                    y
                );
            }
        }
    );


    rc.strokeStyle =
        '#91a8ff';

    rc.lineWidth = 3;

    rc.stroke();


    $('#replayEmpty').style.display =
        'none';
}


/* =========================================================
   EVENT BINDING
========================================================= */

function bind() {

    /* Camera */

    cameraBtn?.addEventListener(
        'click',
        startCamera
    );


    /* Recording */

    $('#recordStart')?.addEventListener(
        'click',
        startRecording
    );


    $('#recordStop')?.addEventListener(
        'click',
        stopRecording
    );


    $('#importRecords')?.addEventListener(
        'change',
        importRecordings
    );


    $('#exportRecords')?.addEventListener(
        'click',
        exportRecordings
    );


    /* Speech */

    speak?.addEventListener(
        'click',
        speakMessage
    );


    /* Save */

    save?.addEventListener(
        'click',
        saveMessage
    );


    /* History */

    $('#clearHistory')?.addEventListener(
        'click',
        clearHistory
    );


    /* Communication Twin */

    $('#resetTwin')?.addEventListener(
        'click',
        () => {

            sessionSigns = 0;

            trace = [];

            $('#replayEmpty').style.display =
                'grid';

            $('#twinState').textContent =
                'SESSION 01';

            $('#twinText').textContent =
                'Waiting for your signing style';

            updateDNA(
                0,
                0
            );

            toast(
                'Communication Twin reset'
            );
        }
    );


    /* Repeat sign */

    $('#repeatSign')?.addEventListener(
        'click',
        () => {

            recognitionState.textContent =
                'REPEAT REQUESTED';

            $('#recognitionMode').textContent =
                'SHOW THE SIGN AGAIN';

            toast(
                'Show the two-hand sign again'
            );
        }
    );


    /* Feedback */

    $('#feedbackBtn')?.addEventListener(
        'click',
        () => {

            if (!lastResult) {

                toast(
                    'Nothing to confirm yet.'
                );

                return;
            }


            toast(
                'Feedback marked as confirmed'
            );
        }
    );


    /* Contrast */

    $('#contrastBtn')?.addEventListener(
        'click',
        () => {

            document.body.classList.toggle(
                'high-contrast'
            );
        }
    );


    /* Demo gestures + navigation */

    document.addEventListener(
        'click',
        e => {

            const el =
                e.target.closest(
                    '[data-demo]'
                );


            if (el) {

                e.preventDefault();


                const [
                    a,
                    b
                ] =
                    el.dataset.demo.split('|');


                demoMessage(
                    a,
                    b
                );


                scrollLive();

                return;
            }


            const anchor =
                e.target.closest(
                    'a[href^="#"]'
                );


            if (anchor) {

                const target =
                    $(anchor.getAttribute('href'));


                if (target) {

                    e.preventDefault();


                    target.scrollIntoView({
                        behavior: 'smooth',
                        block: 'start'
                    });
                }
            }

        }
    );


    /* Start buttons */

    [
        'heroStart',
        'topStart',
        'finalStart'
    ].forEach(id => {

        $('#' + id)?.addEventListener(
            'click',
            scrollLive
        );

    });
}


/* =========================================================
   WINDOW RESIZE
========================================================= */

window.addEventListener(
    'resize',
    () => {

        if (video?.videoWidth) {

            overlay.width =
                video.videoWidth;

            overlay.height =
                video.videoHeight;
        }
    }
);


/* =========================================================
   INITIALIZE
========================================================= */

bind();

loadHistory();


/* =========================================================
   LOAD GESTURE VOCABULARY FROM API
========================================================= */

(async () => {

    const data =
        await api(
            '/api/v1/gestures'
        );


    const dualFromApi =
        (data?.gestures || [])
            .filter(
                g =>
                    g.model?.includes('+')
            )
            .map(
                g => ({
                    label: g.label,
                    text: g.text
                })
            );


    const list =
        dualFromApi.length
            ? dualFromApi
            : Object.values(dualMap)
                .map(
                    ([label, text]) => ({
                        label,
                        text
                    })
                );


    const box =
        $('#gestureList');


    if (box) {

        box.innerHTML =
            list
                .map(
                    g => `
                        <button
                            type="button"
                            data-demo="${esc(g.label)}|${esc(g.text)}"
                            title="Preview ${esc(g.label)}"
                        >
                            ${esc(g.label)}
                        </button>
                    `
                )
                .join('');
    }

})();