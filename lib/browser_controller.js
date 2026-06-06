import { spawn } from 'child_process';

let activeBrowser = null;
let vncProcesses = []; 

async function startVNCStack() {
    console.log('[VNC] Starting Xvfb + x11vnc + websockify (Low Memory Mode)...');
    stopVNCStack(); // Ensure clean slate synchronously

    // Start Xvfb — Drop to 400x800x16 (Smartphone size, huge memory savings)
    const xvfb = spawn('Xvfb', [':99', '-screen', '0', '400x800x16'], { shell: true });
    vncProcesses.push(xvfb);
    
    // Give Xvfb time to initialize asynchronously
    await new Promise(r => setTimeout(r, 2000));
    process.env.DISPLAY = ':99';

    // Start VNC and WebSockify with EXTREMELY low CPU footprint to prevent Hugging Face pausing.
    // Removed -ncache 10 as it allocates massive off-screen memory buffers.
    const vnc = spawn('x11vnc', ['-display', ':99', '-forever', '-shared', '-nopw', '-rfbport', '5900', '-noxdamage', '-defer', '5', '-noshm'], { shell: true });
    vncProcesses.push(vnc);
    
    await new Promise(r => setTimeout(r, 1000));
    const ws = spawn('websockify', ['--web', '/usr/share/novnc', '6080', 'localhost:5900'], { shell: true });
    vncProcesses.push(ws);

    // Optional: pipe logs to console to see if they crash
    ws.stderr.on('data', d => console.error('[websockify err]', d.toString()));
    ws.stdout.on('data', d => console.log('[websockify log]', d.toString()));

    console.log('[VNC] Stack ready! Xvfb :99 → x11vnc :5900 → websockify :6080');
}

function stopVNCStack() {
    console.log('[VNC] Tearing down VNC stack...');
    for (const p of vncProcesses) {
        try { p.kill('SIGKILL'); } catch (e) {}
    }
    vncProcesses = [];
    console.log('[VNC] Cleaned up.');
}

export async function launchInteractiveBrowser(email, db) {
    if (activeBrowser) {
        await activeBrowser.close().catch(() => {});
    }

    // Boot the entire VNC stack on demand
    await startVNCStack();

    // Small delay for VNC to fully stabilize
    await new Promise(r => setTimeout(r, 3000));

    // Dynamic import playwright (it's big, only load when needed)
    const { chromium } = await import('playwright-core');

    // Launch Chrome in "headful" mode on the virtual display with EXTREME RAM limits
    activeBrowser = await chromium.launch({
        headless: false,
        executablePath: '/usr/bin/google-chrome-stable',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu',
            '--disable-software-rasterizer',
            '--disable-background-networking',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
            '--no-first-run',
            '--no-zygote',
            '--disable-extensions',
            '--disable-features=Translate,OptimizationHints,MediaRouter',
            '--mute-audio',
            '--js-flags="--max-old-space-size=256"',
            '--window-size=400,800',
            '--display=:99'
        ]
    });

    const context = await activeBrowser.newContext({
        viewport: { width: 400, height: 800 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });

    const page = await context.newPage();

    let capturedBearer = null;

    // Listen to network requests for the exact moment we get the Bearer token
    page.on('request', request => {
        const url = request.url();
        if (url.includes('/api/v0/users/current') || url.includes('/api/v0/chat/completion')) {
            const auth = request.headers()['authorization'];
            if (auth && auth.startsWith('Bearer ')) {
                capturedBearer = auth.replace('Bearer ', '');
                console.log('[Browser] Successfully extracted Bearer JWT token!');
            }
        }
    });

    // Send the user to the DeepSeek login page
    await page.goto('https://chat.deepseek.com/sign_in');
    console.log('[Browser] Navigated to login page. Waiting for human to solve captcha via VNC...');

    // Wait until we actually capture the Bearer token from the network (meaning they passed Cloudflare AND logged in)
    try {
        console.log('[Browser] Waiting for human to solve captcha via VNC. You have 5 minutes...');
        let attempts = 0;
        while (!capturedBearer && attempts < 300) { // 5 minutes max
            await page.waitForTimeout(1000);
            attempts++;
        }

        if (!capturedBearer) {
            throw new Error('5 minutes passed but could not intercept Bearer token. Interaction timed out.');
        }

        console.log('[Browser] Login successful. Extracting cookies...');

        const cookies = await context.cookies();
        
        const dsSession = cookies.find(c => c.name === 'ds_session_id');
        const wafHash = cookies.find(c => c.name === 'aws-waf-token');
        
        if (!dsSession) throw new Error('Missing ds_session_id cookie');

        let cookieString = `ds_session_id=${dsSession.value}`;
        if (wafHash) cookieString += `; aws-waf-token=${wafHash.value}`;

        const rawToken = JSON.stringify({
            bearer: capturedBearer,
            cookie: cookieString
        });

        // Save successfully extracted account to our SQLite Database natively!
        const existing = db.prepare('SELECT id FROM accounts WHERE email = ?').get(email);
        if (existing) {
            db.prepare('UPDATE accounts SET token = ?, active = 1 WHERE id = ?').run(rawToken, existing.id);
            console.log(`[Browser] Token updated for existing account: ${email}`);
        } else {
            db.prepare('INSERT INTO accounts (email, password, token) VALUES (?, ?, ?)').run(email, '', rawToken);
            console.log(`[Browser] Created new database account for: ${email}`);
        }

        // Close the browser and tear down VNC to free ALL RAM immediately
        await activeBrowser.close();
        activeBrowser = null;
        stopVNCStack();
        return { success: true, message: "Browser interaction completed securely!" };

    } catch (e) {
        console.error('[Browser Error]', e);
        if (activeBrowser) {
            await activeBrowser.close();
            activeBrowser = null;
        }
        stopVNCStack();
        throw e;
    }
}
