/*
 * scripts/apply-app-theme.js
 * One-off script: insert the Nedhub app theme stylesheet + Manrope font link
 * after the last existing stylesheet link in each CSS-only page.
 * Run once from the repo root:  node scripts/apply-app-theme.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = process.cwd();
const STYLE_DIR = 'src/styles';
const THEME_FILE = 'nedhub-app.css';
const FONT_LINK =
    '<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400,500,700,800&display=swap" rel="stylesheet">';

// Pages to theme and the stylesheet href relative to each page.
const PAGES = {
    // Auth pages live one level deeper (src/pages/auth/) => ../../styles/
    'src/pages/auth/login.html': '../../styles/nedhub-app.css',
    'src/pages/auth/register.html': '../../styles/nedhub-app.css',
    'src/pages/auth/verify-email.html': '../../styles/nedhub-app.css',
    'src/pages/auth/forgot-password.html': '../../styles/nedhub-app.css',
    'src/pages/auth/reset-password.html': '../../styles/nedhub-app.css',
    // Dashboard pages live in src/pages/dashboard/ (also two levels from src/) => ../../styles/
    'src/pages/dashboard/overview.html': '../../styles/nedhub-app.css',
    'src/pages/dashboard/transactions.html': '../../styles/nedhub-app.css',
    'src/pages/dashboard/history.html': '../../styles/nedhub-app.css',
    'src/pages/dashboard/blacklist.html': '../../styles/nedhub-app.css',
    'src/pages/dashboard/templates.html': '../../styles/nedhub-app.css',
    'src/pages/dashboard/reports.html': '../../styles/nedhub-app.css',
    'src/pages/dashboard/settings.html': '../../styles/nedhub-app.css',
};

const THEME_LINK_TEMPLATE = (href) =>
    `<link rel="stylesheet" href="${href}">`;

const stylesheetRe = /<link[^>]+rel=["']stylesheet["'][^>]*>/gi;

function lastStylesheetIndex(html) {
    stylesheetRe.lastIndex = 0;
    let last = -1;
    let match;
    while ((match = stylesheetRe.exec(html)) !== null) {
        last = match.index;
    }
    return last;
}

function insertAfter(html, insertAt, toInsert) {
    return html.slice(0, insertAt) + toInsert + html.slice(insertAt);
}

function main() {
    const changed = [];
    const skipped = [];

    for (const [page, themeHref] of Object.entries(PAGES)) {
        const filePath = path.join(REPO_ROOT, page);
        if (!fs.existsSync(filePath)) {
            console.log(`MISSING (skipped): ${page}`);
            skipped.push(page);
            continue;
        }

        let html = fs.readFileSync(filePath, 'utf8');

        // Idempotent: already themed?
        if (html.includes(THEME_FILE)) {
            console.log(`ALREADY THEMED (skipped): ${page}`);
            skipped.push(page);
            continue;
        }

        const lastIdx = lastStylesheetIndex(html);
        if (lastIdx === -1) {
            console.log(`NO STYLESHEET LINK FOUND (skipped): ${page}`);
            skipped.push(page);
            continue;
        }

        // Find the end of that link tag.
        const endOfLink = html.indexOf('>', lastIdx);
        if (endOfLink === -1) {
            console.log(`MALFORMED LINK (skipped): ${page}`);
            skipped.push(page);
            continue;
        }

        const insertPos = endOfLink + 1;
        const toInsert = `\n    ${FONT_LINK}\n    ${THEME_LINK_TEMPLATE(themeHref)}`;

        html = insertAfter(html, insertPos, toInsert);
        fs.writeFileSync(filePath, html, 'utf8');
        changed.push({ page, themeHref });
        console.log(`THEMED: ${page}  (+ ${themeHref})`);
    }

    console.log('\n--- Summary ---');
    console.log(`Changed: ${changed.length}`);
    console.log(`Skipped: ${skipped.length}`);
    return { changed, skipped };
}

main();
