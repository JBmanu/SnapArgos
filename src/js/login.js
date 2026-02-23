const {chromium} = require('playwright');

const USERNAME = "manueljb";
const PASSWORD = "17luglioSna#";
const SNAP_URL = "https://snap.berkeley.edu/snap/snap.html";

(async () => {
    const browser = await chromium.launch({headless: false, slowMo: 50});
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(SNAP_URL, {waitUntil: 'networkidle'});

    // Aspetta che l'engine Snap sia pronto
    await page.waitForFunction(() => window.world && world.children.length > 0);
    await page.waitForFunction(() => world.children[0].cloud);

    try {
        const loginResult = await page.evaluate(({user, pass}) => {
            return new Promise((resolve, reject) => {
                const ide = world.children[0];

                try {
                    // genera hash password
                    ide.cloud.login(user, pass, false, // persist
                        () => resolve("OK"),
                        err => reject(new Error("Login fallito: " + JSON.stringify(err)))
                    );
                } catch (e) {
                    reject(e);
                }
            });
        }, {user: USERNAME, pass: PASSWORD});

        console.log("Login completato:", loginResult);

    } catch (err) {
        console.error("Errore durante login:", err);
    }
})();