const $ = (id) => document.getElementById(id);

const DEFAULT_SERVER = 'http://127.0.0.1:27124';

let testPassed = false;

function generateToken() {
	const bytes = new Uint8Array(24);
	crypto.getRandomValues(bytes);
	return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function setStatus(text, cls) {
	const el = $('status');
	el.textContent = text;
	el.className = 'status' + (cls ? ' ' + cls : '');
}

function originPatternFromUrl(serverUrl) {
	try {
		const u = new URL(serverUrl);
		if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
		if (u.hostname !== '127.0.0.1' && u.hostname !== 'localhost') return null;
		const port = u.port || (u.protocol === 'https:' ? '443' : '80');
		return `${u.protocol}//${u.hostname}:${port}/*`;
	} catch {
		return null;
	}
}

async function ensurePermission(serverUrl) {
	const pattern = originPatternFromUrl(serverUrl);
	if (!pattern) return true;
	const has = await chrome.permissions.contains({ origins: [pattern] });
	if (has) return true;
	return chrome.permissions.request({ origins: [pattern] });
}

async function testConnection() {
	const serverUrl = ($('serverUrl').value.trim() || DEFAULT_SERVER).replace(/\/$/, '');
	const token = $('apiToken').value.trim();

	const granted = await ensurePermission(serverUrl);
	if (!granted) {
		testPassed = false;
		setStatus('Permission denied for that host.', 'err');
		return;
	}

	setStatus('Testing…', '');

	try {
		const res = await fetch(serverUrl + '/health', {
			headers: { Authorization: `Bearer ${token}` },
		});

		if (res.status === 401) {
			testPassed = false;
			setStatus('Token mismatch — check the token in Obsidian.', 'err');
		} else if (!res.ok) {
			testPassed = false;
			setStatus(`Server returned ${res.status}.`, 'err');
		} else {
			const data = await res.json().catch(() => ({}));
			if (data.plugin !== 'lexophile') {
				testPassed = false;
				setStatus(`Unexpected plugin id: "${data.plugin}".`, 'err');
			} else if (!data.authRequired) {
				testPassed = false;
				setStatus('Reached the plugin, but it has no token set. Add this token in Obsidian.', 'err');
			} else {
				testPassed = true;
				setStatus('✓ Connected. Tokens match.', 'ok');
			}
		}
	} catch {
		testPassed = false;
		setStatus('Could not reach Obsidian. Is it open with Lexophile enabled?', 'err');
	}
}

async function copyToken() {
	const token = $('apiToken').value.trim();
	if (!token) return;
	try {
		await navigator.clipboard.writeText(token);
		const btn = $('copy');
		const original = btn.textContent;
		btn.textContent = 'Copied!';
		setTimeout(() => (btn.textContent = original), 1500);
	} catch {
		// Fall back: select the input so the user can copy manually
		$('apiToken').select();
	}
}

async function finish() {
	const serverUrl = $('serverUrl').value.trim() || DEFAULT_SERVER;
	const apiToken = $('apiToken').value.trim();

	if (!apiToken) return;

	const granted = await ensurePermission(serverUrl);
	if (!granted) {
		setStatus('Permission denied for that host. Cannot finish setup.', 'err');
		return;
	}

	await chrome.storage.sync.set({
		serverUrl,
		apiToken,
		onboardingComplete: true,
	});

	$('setup').classList.add('hidden');
	$('done').classList.remove('hidden');
}

document.addEventListener('DOMContentLoaded', async () => {
	const stored = await chrome.storage.sync.get({ serverUrl: DEFAULT_SERVER, apiToken: '' });
	$('serverUrl').value = stored.serverUrl;

	let token = stored.apiToken;
	if (!token) {
		token = generateToken();
		// Persist immediately so reopening the welcome page shows the same token
		// the user may have already pasted into Obsidian.
		await chrome.storage.sync.set({ apiToken: token });
	}
	$('apiToken').value = token;
});

$('serverUrl').addEventListener('input', () => {
	testPassed = false;
	setStatus('', '');
});
$('copy').addEventListener('click', copyToken);
$('test').addEventListener('click', testConnection);
$('finish').addEventListener('click', finish);
$('closeBtn').addEventListener('click', () => window.close());
