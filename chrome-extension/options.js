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

async function save() {
	const serverUrl = $('serverUrl').value.trim() || DEFAULTS.serverUrl;
	const apiToken = $('apiToken').value;
	await chrome.storage.sync.set({ serverUrl, apiToken });
	setStatus('Saved.', 'ok');
}

async function testConnection() {
	const serverUrl = $('serverUrl').value.trim() || DEFAULTS.serverUrl;
	const apiToken = $('apiToken').value;
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
