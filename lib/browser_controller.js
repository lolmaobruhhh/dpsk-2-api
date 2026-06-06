import { exec } from 'child_process';

let activeBrowser = null;

async function startVNCStack() {
    console.log('[VNC] Starting Xvfb + x11vnc + websockify via bash...');

    // Kill any existing instances to free up ports
    stopVNCStack();

    // Start Xvfb
    exec('Xvfb :99 -screen 0 1280x720x24');
    
    // Give Xvfb time to initialize asynchronously
    await new Promise(r => setTimeout(r, 2000));
    process.env.DISPLAY = ':99';

    // Start VNC and WebSockify
    exec('x11vnc -display :99 -forever -shared -nopw -rfbport 5900');
    
    // Adding a tiny delay to ensure VNC is ready before websockify binds
    await new Promise(r => setTimeout(r, 1000));
    exec('websockify --web /usr/share/novnc 6080 localhost:5900');

    console.log('[VNC] Stack ready! Xvfb :99 → x11vnc :5900 → websockify :6080');
}

function stopVNCStack() {
    console.log('[VNC] Tearing down VNC stack...');
    try { exec('pkill -f Xvfb'); } catch(e) {}
    try { exec('pkill -f x11vnc'); } catch(e) {}
    try { exec('pkill -f websockify'); } catch(e) {}
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
    const { chromium } = await import('playwright');

    // Launch Chrome in "headful" mode on the virtual display
    activeBrowser = await chromium.launch({
        headless: false,
        executablePath: '/usr/bin/google-chrome-stable',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--window-size=1280,720',
            '--display=:99'
        ]
    });

    const context = await activeBrowser.newContext({
        viewport: { width: 1280, height: 720 },
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
