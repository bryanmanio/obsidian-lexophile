const DEFAULTS = {
	serverUrl: 'http://127.0.0.1:27124',
	apiToken: '',
};

const $ = (id) => document.getElementById(id);

async function load() {
	const stored = await chrome.storage.sync.get(DEFAULTS);
	const settings = { ...DEFAULTS, ...stored };
	$('serverUrl').value = settings.serverUrl;
	$('apiToken').value = settings.apiToken;
}

// Build a host_permission origin pattern from a server URL like
// "http://127.0.0.1:27200" → "http://127.0.0.1:27200/*". Returns null if invalid.
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

// Ensure the extension has runtime permission to talk to the chosen server URL.
// The default port (27124) is already in host_permissions; anything else needs
// to be granted by the user via chrome.permissions.request.
async function ensurePermission(serverUrl) {
	const pattern = originPatternFromUrl(serverUrl);
	if (!pattern) return true; // not a localhost URL; let fetch fail naturally

	const has = await chrome.permissions.contains({ origins: [pattern] });
	if (has) return true;

	const granted = await chrome.permissions.request({ origins: [pattern] });
	return granted;
}

async function save() {
	const serverUrl = $('serverUrl').value.trim() || DEFAULTS.serverUrl;
	const apiToken = $('apiToken').value;

	const granted = await ensurePermission(serverUrl);
	if (!granted) {
		setStatus('Permission denied for that host. Settings not saved.', 'err');
		return;
	}

	await chrome.storage.sync.set({ serverUrl, apiToken });
	setStatus('Saved.', 'ok');
}

async function testConnection() {
	const serverUrl = $('serverUrl').value.trim() || DEFAULTS.serverUrl;
	const apiToken = $('apiToken').value;

	const granted = await ensurePermission(serverUrl);
	if (!granted) {
		setStatus('Permission denied for that host.', 'err');
		return;
	}

	setStatus('Testing…', '');
	try {
		const headers = {};
		if (apiToken) headers.Authorization = `Bearer ${apiToken}`;
		const res = await fetch(serverUrl.replace(/\/$/, '') + '/health', { headers });
		if (res.status === 401) {
			setStatus('Token mismatch — check the token in Obsidian.', 'err');
			return;
		}
		if (!res.ok) {
			setStatus(`Server returned ${res.status}`, 'err');
			return;
		}
		const data = await res.json();
		if (data.plugin !== 'lexophile') {
			setStatus(`Got response, but plugin id is "${data.plugin}".`, 'err');
		} else if (apiToken && !data.authRequired) {
			setStatus('Connected, but Obsidian has no token set. Add this token there too.', 'err');
		} else {
			setStatus('Connected to Lexophile.', 'ok');
		}
	} catch {
		setStatus('Could not reach server. Is Obsidian open?', 'err');
	}
}

function setStatus(text, cls) {
	const el = $('status');
	el.textContent = text;
	el.className = 'status' + (cls ? ' ' + cls : '');
}

document.addEventListener('DOMContentLoaded', load);
$('save').addEventListener('click', save);
$('test').addEventListener('click', testConnection);
