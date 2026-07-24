document.getElementById('app').innerHTML = '<div class="action-btn-group"><button class="floating-btn" id="tb1"></button><button class="floating-btn floating-btn-accent" id="lb1"></button></div><div class="dashboard-container"><div class="login-header"><div class="logo-icon">AI</div><span class="logo-text">W-ai-api</span></div><div class="dashboard-grid"><div class="stat-card flex-between"><div><div class="stat-title">今日用量汇总</div><div class="flex-baseline"><span class="neuron-value" id="n1">0</span><span class="neuron-label">Neurons</span></div></div><div><div class="progress-container"><div class="progress-bar" id="p1" style="width:0%"></div></div><div class="progress-detail"><span id="l1">总限额: 0 Neurons</span><span class="percent-value" id="r1">0.00%</span></div></div></div><div class="stat-card" id="mc2"><div class="public-chart-wrapper" id="w1" style="display:none"><div class="chart-col-left"><canvas id="c1"></canvas></div><div class="chart-col-right"><div class="chart-legend-scroll" id="g1"></div></div></div><div class="chart-placeholder" id="h1"><span class="spinner spinner-lg"></span><span>正在载入数据...</span></div></div></div><div class="site-footer"><span>&copy; 2026 W-ai-api</span><a class="footer-link" href="/docs/" target="_blank">文档中心</a></div></div><div class="modal-overlay" id="m1"><div class="modal-card"><div class="modal-header"><h3 id="login-modal-title">管理员登录</h3><button class="close-btn" id="cb1"></button></div><div class="form-group" id="login-password-group"><label for="pw1">管理员密码</label><input type="password" id="pw1" placeholder="请输入管理员密码"></div><div class="form-group" id="login-totp-group" style="display:none"><label for="t1">2FA 验证码</label><input type="text" id="t1" placeholder="6 位数字" maxlength="6" style="font-size:18px;letter-spacing:4px;text-align:center;font-family:monospace"></div><div class="modal-footer"><button class="btn btn-secondary btn-sm" id="ccl1">取消</button><button class="btn btn-primary btn-sm" id="clg1">登录</button></div></div></div>';
const ICONS = {
	sun: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" /></svg>',
	moon: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" /></svg>',
	user: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>',
	close: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>'
};

function initUI() {
	var e = document.getElementById('tb1');
	if (e) {
		var sun = document.createElement('span');
		sun.className = 'theme-icon-sun';
		sun.style.display = 'none';
		sun.innerHTML = ICONS.sun;
		var moon = document.createElement('span');
		moon.className = 'theme-icon-moon';
		moon.innerHTML = ICONS.moon;
		e.append(sun, moon);
		e.onclick = toggleTheme;
	}
	e = document.getElementById('lb1');
	if (e) { e.innerHTML = ICONS.user; e.onclick = openLoginModal; }
	e = document.getElementById('cb1');
	if (e) e.innerHTML = ICONS.close;
	e = document.getElementById('pw1');
	if (e) e.addEventListener('keydown', function(ev) { if (ev.key === 'Enter') submitLogin(); });
	document.getElementById('ccl1').onclick = closeLoginModal;
	document.getElementById('clg1').onclick = submitLogin;
}

function showToast(message, type) {
	type = type || 'success';
	var container = document.querySelector('.toast-container');
	if (!container) {
		container = document.createElement('div');
		container.className = 'toast-container';
		document.body.appendChild(container);
	}
	var toast = document.createElement('div');
	toast.className = 'toast toast-' + type;
	var svg = '';
	if (type === 'success') svg = '<svg class="toast-icon" style="color:#fff" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>';
	else if (type === 'error') svg = '<svg class="toast-icon" style="color:#fff" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>';
	else svg = '<svg class="toast-icon" style="color:#fff" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>';
	toast.innerHTML = svg + '<span>' + message + '</span>';
	container.appendChild(toast);
	toast.offsetHeight;
	toast.classList.add('show');
	setTimeout(function() {
		toast.classList.remove('show');
		setTimeout(function() { toast.remove(); }, 400);
	}, 3000);
}

function initTheme() {
	var t = localStorage.getItem('theme');
	if (t) document.documentElement.setAttribute('data-theme', t);
	else if (!window.matchMedia('(prefers-color-scheme:dark)').matches) document.documentElement.setAttribute('data-theme', 'light');
	updateThemeIcons();
}

var publicModelsChartInstance = null;
var lastPublicSummaryData = null;
var chartJsLoaded = false;

function loadChartJS() {
	return new Promise(function(resolve) {
		if (typeof Chart !== 'undefined') { chartJsLoaded = true; resolve(); return; }
		var s = document.createElement('script');
		s.src = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js';
		s.crossOrigin = 'anonymous';
		s.onload = function() { chartJsLoaded = true; resolve(); };
		document.head.appendChild(s);
	});
}

function toggleTheme() {
	var cur = document.documentElement.getAttribute('data-theme') || 'dark';
	var next = cur === 'light' ? 'dark' : 'light';
	document.documentElement.setAttribute('data-theme', next);
	localStorage.setItem('theme', next);
	updateThemeIcons();
	if (lastPublicSummaryData) renderPublicSummary(lastPublicSummaryData);
}

function updateThemeIcons() {
	var dark = document.documentElement.getAttribute('data-theme') !== 'light';
	document.querySelectorAll('.theme-icon-sun').forEach(function(el) { el.style.display = dark ? 'block' : 'none'; });
	document.querySelectorAll('.theme-icon-moon').forEach(function(el) { el.style.display = dark ? 'none' : 'block'; });
}

function openLoginModal() {
	document.getElementById('m1').classList.add('active');
	_tempToken = null;
	document.getElementById('login-modal-title').innerText = '管理员登录';
	document.getElementById('login-password-group').style.display = 'block';
	document.getElementById('login-totp-group').style.display = 'none';
	document.getElementById('t1').value = '';
	var inp = document.getElementById('pw1');
	if (inp) { inp.value = ''; setTimeout(function() { inp.focus(); }, 100);}
}

initUI();
initTheme();
document.querySelectorAll('.stat-card').forEach(function(el, i) {
	el.classList.add('animate-fade-in-up');
	if (i === 0) el.classList.add('delay-1');
	else if (i === 1) el.classList.add('delay-2');
});

window.onload = function() { loadPublicSummary(); };

async function loadPublicSummary() {
	try {
		var res = await fetch('/api/usage/summary');
		renderPublicSummary(await res.json());
	} catch (e) { console.error(e); }
}

function animateNumber(id, end, duration) {
	duration = duration || 1200;
	var el = document.getElementById(id);
	if (!el) return;
	var start = parseInt(el.innerText.replace(/,/g, ''), 10);
	if (isNaN(start) || start <= 0) start = end > 100 ? 100 : 0;
	var range = end - start;
	if (range === 0) { el.innerText = end.toLocaleString(); return; }
	var t0 = performance.now();
	function update(now) {
		var p = Math.min((now - t0) / duration, 1);
		el.innerText = Math.ceil(start + range * (1 - Math.pow(2, -10 * p))).toLocaleString();
		if (p < 1) requestAnimationFrame(update);
		else el.innerText = end.toLocaleString();
	}
	requestAnimationFrame(update);
}

async function renderPublicSummary(data) {
	lastPublicSummaryData = data;
	var pct = Number(data.usagePercentage).toFixed(2);
	animateNumber('n1', Math.ceil(data.totalNeuronsToday), 1000);
	document.getElementById('p1').style.width = pct + '%';
	document.getElementById('l1').innerText = '总限额: ' + Number(data.totalLimit).toLocaleString() + ' Neurons';
	document.getElementById('r1').innerText = pct + '%';
	var w = document.getElementById('w1');
	var h = document.getElementById('h1');
	var lg = document.getElementById('g1');
	if (data.modelsToday && data.modelsToday.length > 0) {
		if (w) w.style.display = 'flex';
		if (h) h.style.display = 'none';
		var sorted = [...data.modelsToday].sort(function(a, b) { return b.neurons - a.neurons; });
		var labels = sorted.map(function(m) { return m.model.split('/').pop(); });
		var vals = sorted.map(function(m) { return m.neurons; });
		var light = document.documentElement.getAttribute('data-theme') === 'light';
		var tColor = light ? '#64748b' : '#94a3b8';
		var bColor = light ? '#fff' : '#1e293b';
		await loadChartJS();
		var ctx = document.getElementById('c1').getContext('2d');
		if (publicModelsChartInstance) publicModelsChartInstance.destroy();
		if (lg) lg.innerHTML = '';
		publicModelsChartInstance = new Chart(ctx, {
			type: 'doughnut',
			data: { labels: labels, datasets: [{ data: vals, backgroundColor: ['#1e40af','#2563eb','#3b82f6','#60a5fa','#93c5fd','#bfdbfe'], borderWidth: 2, borderColor: bColor }] },
			options: { responsive: true, maintainAspectRatio: false, cutout: '70%', animation: { duration: 300, easing: 'easeOutQuart' }, plugins: { legend: { display: false } } }
		});
		if (lg) {
			var colors = ['#1e40af','#2563eb','#3b82f6','#60a5fa','#93c5fd','#bfdbfe'];
			var total = vals.reduce(function(a, b) { return a + b; }, 0);
			labels.forEach(function(label, i) {
				var item = document.createElement('div');
				item.style.cssText = 'display:flex;align-items:center;gap:8px;font-size:12px;color:' + tColor + ';opacity:0;transform:translateX(10px);transition:all 0.4s cubic-bezier(0.16,1,0.3,1)';
				item.innerHTML = '<span style="width:8px;height:8px;border-radius:50%;background:' + colors[i % colors.length] + ';flex-shrink:0"></span><span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;font-weight:500" title="' + label + '">' + label + '</span><span style="color:var(--text-muted);font-family:monospace;font-size:11px;flex-shrink:0">' + (total > 0 ? (vals[i] / total * 100).toFixed(1) : '0.0') + '%</span>';
				lg.appendChild(item);
				setTimeout(function() { item.style.opacity = '1'; item.style.transform = 'translateX(0)'; }, i * 80);
			});
		}
	} else {
		if (w) w.style.display = 'none';
		if (h) { h.style.display = 'flex'; h.innerHTML = '<svg style="width:32px;height:32px;opacity:.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z"/></svg><span>今日暂无消耗数据</span>'; }
		if (publicModelsChartInstance) { publicModelsChartInstance.destroy(); publicModelsChartInstance = null; }
	}
}

var _tempToken = null;

async function submitLogin() {
	var pw = document.getElementById('pw1').value;
	var totpCode = document.getElementById('t1').value;
	if (_tempToken && !totpCode) {
		showToast('请输入 2FA 验证码', 'warning');
		return;
	}
	var body = { password: pw };
	if (_tempToken) {
		body.tempToken = _tempToken;
		body.totpCode = totpCode;
	}
	var res = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
	if (res.ok) {
		var data = await res.json();
		if (data.needs2fa) {
			_tempToken = data.tempToken;
			document.getElementById('login-modal-title').innerText = '两步验证';
			document.getElementById('login-password-group').style.display = 'none';
			document.getElementById('login-totp-group').style.display = 'block';
			document.getElementById('t1').value = '';
			setTimeout(function() { document.getElementById('t1').focus(); }, 100);
			showToast('密码验证通过，请输入 2FA 验证码');
			return;
		}
		showToast('登录成功！跳转中...');
		setTimeout(function() { window.location.href = '/admin'; }, 600);
	} else {
		var d = await res.json();
		showToast('登录失败: ' + (d.error || '密码不正确！'), 'error');
	}
}

function closeLoginModal() {
	document.getElementById('m1').classList.remove('active');
	_tempToken = null;
	document.getElementById('login-modal-title').innerText = '管理员登录';
	document.getElementById('login-password-group').style.display = 'block';
	document.getElementById('login-totp-group').style.display = 'none';
	document.getElementById('t1').value = '';
}