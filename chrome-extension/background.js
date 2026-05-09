const DEFAULT_SETTINGS = {
	serverUrl: 'http://127.0.0.1:27124',
	apiToken: '',
	onboardingComplete: false,
};

const MENU_ID = 'lexophile-add-word';

chrome.runtime.onInstalled.addListener((details) => {
	chrome.contextMenus.create({
		id: MENU_ID,
		title: 'Add word to Obsidian',
		contexts: ['selection'],
	});

	if (details.reason === 'install') {
		chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') });
	}
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
	if (info.menuItemId !== MENU_ID) return;

	const settings = await getSettings();

	if (!settings.onboardingComplete) {
		await toast(tab, 'Lexophile: finish setup first — opening welcome page.', 'error');
		chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') });
		return;
	}

	const raw = (info.selectionText || '').trim();
	const word = raw.split(/\s+/)[0]?.replace(/[^\p{L}\p{N}'’-]/gu, '');

	if (!word) {
		await toast(tab, 'Lexophile: please select a word first.', 'error');
		return;
	}

	if (raw.split(/\s+/).length > 1) {
		console.log(`[Lexophile] Multiple words selected, using "${word}"`);
	}

	try {
		const entry = await lookupWord(word);
		entry.source = tab?.url || '';
		const result = await sendToObsidian(settings, entry);
		const verb = result.action === 'skipped' ? 'already exists' : result.action;
		await toast(tab, `Lexophile: ${verb} "${entry.word}"`, 'success');
	} catch (err) {
		console.error('[Lexophile]', err);
		await toast(tab, `Lexophile: ${err.message}`, 'error');
	}
});

// Click the toolbar icon → options if onboarded, welcome otherwise
chrome.action.onClicked.addListener(async () => {
	const settings = await getSettings();
	if (settings.onboardingComplete) {
		chrome.runtime.openOptionsPage();
	} else {
		chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') });
	}
});

async function getSettings() {
	const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
	return { ...DEFAULT_SETTINGS, ...stored };
}

async function lookupWord(word) {
	const url = `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`;
	const res = await fetch(url);

	if (res.status === 404) {
		throw new Error(`No definition found for "${word}".`);
	}
	if (!res.ok) {
		throw new Error(`Dictionary API returned ${res.status}.`);
	}

	const data = await res.json();
	if (!Array.isArray(data) || data.length === 0) {
		throw new Error(`Empty response for "${word}".`);
	}

	const first = data[0];
	const meaning = first.meanings?.[0];
	const definition = meaning?.definitions?.[0];
	if (!meaning || !definition) {
		throw new Error(`No definition data for "${word}".`);
	}

	const phonetic = first.phonetic || first.phonetics?.find((p) => p.text)?.text || '';

	return {
		word: first.word,
		partOfSpeech: meaning.partOfSpeech,
		definition: definition.definition,
		example: definition.example || '',
		phonetic,
	};
}

async function sendToObsidian(settings, entry) {
	const headers = { 'Content-Type': 'application/json' };
	if (settings.apiToken) {
		headers.Authorization = `Bearer ${settings.apiToken}`;
	}

	const url = settings.serverUrl.replace(/\/$/, '') + '/word';

	let res;
	try {
		res = await fetch(url, {
			method: 'POST',
			headers,
			body: JSON.stringify(entry),
		});
	} catch (err) {
		throw new Error('Could not reach Obsidian. Is the Lexophile plugin running?');
	}

	if (res.status === 401) {
		throw new Error('Obsidian rejected the API token. Check Lexophile options.');
	}
	if (!res.ok) {
		const errBody = await res.text().catch(() => '');
		throw new Error(`Obsidian returned ${res.status}${errBody ? `: ${errBody}` : ''}`);
	}

	return res.json();
}

async function toast(tab, message, kind) {
	if (!tab?.id) return;
	try {
		await chrome.scripting.executeScript({
			target: { tabId: tab.id },
			func: showToast,
			args: [message, kind],
		});
	} catch (err) {
		// Some pages (chrome://, the web store, etc.) don't allow script injection.
		// Fall back to console — the message is still in the service worker log.
		console.log(`[Lexophile toast] ${message}`);
	}
}

// Runs in the page context, not the service worker.
function showToast(message, kind) {
	const id = '__lexophile_toast__';
	document.getElementById(id)?.remove();

	const el = document.createElement('div');
	el.id = id;
	el.textContent = message;
	const bg = kind === 'error' ? '#b00020' : '#7d53dc';
	el.style.cssText = `
		position: fixed;
		top: 20px;
		right: 20px;
		max-width: 360px;
		padding: 12px 16px;
		background: ${bg};
		color: #fff;
		border-radius: 8px;
		font: 14px/1.4 -apple-system, system-ui, sans-serif;
		box-shadow: 0 4px 16px rgba(0,0,0,0.25);
		z-index: 2147483647;
		opacity: 0;
		transform: translateY(-8px);
		transition: opacity 150ms ease, transform 150ms ease;
	`;
	document.body.appendChild(el);
	requestAnimationFrame(() => {
		el.style.opacity = '1';
		el.style.transform = 'translateY(0)';
	});
	setTimeout(() => {
		el.style.opacity = '0';
		el.style.transform = 'translateY(-8px)';
		setTimeout(() => el.remove(), 200);
	}, 3500);
}
