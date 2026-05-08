'use strict';
'require view';
'require fs';
'require ui';

var LOGO_URL = '/luci-static/resources/proxy-pool/logo.png';
var DEFAULT_IP_FILE = '/opt/proxy-pool/IP.txt';

var PP_STYLE =
  '.pp-root{--pp-blue:#4f6df5;--pp-green:#20a56b;--pp-red:#e94f5f;--pp-amber:#f4a000;--pp-ink:#151936;--pp-muted:#667085;--pp-line:#e7eaf3;--pp-bg:#f6f7fb;color:var(--pp-ink)}' +
  '.pp-root .cbi-section{border:1px solid var(--pp-line);box-shadow:0 1px 3px rgba(20,25,54,.06);border-radius:8px;margin-bottom:14px;padding:18px;background:#fff}' +
  '.pp-hero{display:flex;align-items:center;justify-content:space-between;gap:18px;border-radius:8px;padding:18px 20px;margin-bottom:14px;background:linear-gradient(135deg,#111827,#243b62);color:#fff;overflow:hidden}' +
  '.pp-brand{display:flex;align-items:center;gap:14px;min-width:0}.pp-logo{width:76px;height:76px;object-fit:contain;border-radius:8px;background:rgba(255,255,255,.92);padding:6px;box-shadow:0 8px 22px rgba(0,0,0,.22)}' +
  '.pp-title{font-size:24px;font-weight:700;line-height:1.1}.pp-subtitle{font-size:13px;color:#d8def0;margin-top:6px}.pp-hero-meta{text-align:right;font-size:13px;color:#dce4ff;line-height:1.8}' +
  '.pp-status-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}.pp-card{border:1px solid var(--pp-line);border-left:5px solid var(--pp-blue);border-radius:8px;padding:13px 14px;background:#fff;min-height:76px}' +
  '.pp-card-good{border-left-color:var(--pp-green);background:#f1fbf6}.pp-card-warn{border-left-color:var(--pp-amber);background:#fff9ec}.pp-card-bad{border-left-color:var(--pp-red);background:#fff4f5}.pp-card-neutral{border-left-color:var(--pp-blue);background:#f4f6ff}' +
  '.pp-card-label{font-size:12px;color:var(--pp-muted);margin-bottom:6px}.pp-card-value{font-size:18px;font-weight:700;word-break:break-word}.pp-card-sub{font-size:12px;color:var(--pp-muted);margin-top:5px;word-break:break-word}' +
  '.pp-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}.pp-form-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px 24px;align-items:end}.pp-form-grid .cbi-value{margin:0;padding:0}' +
  '.pp-upload-panel{border:1px dashed #b7c2f9;border-radius:8px;background:#f7f8ff;padding:14px;margin-bottom:12px}.pp-upload-row{display:flex;flex-wrap:wrap;gap:10px;align-items:center}.pp-path{font-size:12px;color:var(--pp-muted);margin-top:9px;word-break:break-all}' +
  '.pp-table-wrap{overflow-x:auto;margin-top:12px}.pp-summary{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0}.pp-pill{display:inline-flex;align-items:center;border-radius:999px;padding:4px 10px;font-size:12px;font-weight:600;background:#eef2ff;color:#3442a4}.pp-pill-good{background:#e9f8f0;color:#087443}.pp-pill-bad{background:#fff1f3;color:#b42333}' +
  '.pp-root table.table{border:1px solid var(--pp-line);border-radius:8px;overflow:hidden}.pp-root table.table th{background:#f4f6fb;color:#344054;font-weight:700}.pp-root table.table td,.pp-root table.table th{vertical-align:middle}.pp-iptxt{width:100%;min-height:160px;font-family:monospace;border-radius:8px}.pp-muted{color:var(--pp-muted)}' +
  '@media(max-width:700px){.pp-hero{align-items:flex-start;flex-direction:column}.pp-hero-meta{text-align:left}.pp-logo{width:62px;height:62px}.pp-title{font-size:21px}}';

function parseJson(text) {
  try {
    return JSON.parse(text || '{}');
  } catch (e) {
    return {};
  }
}

function ctl(args) {
  return fs.exec_direct('/usr/bin/proxy-pool-ctl', args).then(parseJson);
}

function badge(text, good) {
  return E('span', {
    'class': good ? 'label label-success' : 'label label-warning'
  }, [text]);
}

function metric(label, value, kind, sub) {
  return E('div', { 'class': 'pp-card pp-card-' + (kind || 'neutral') }, [
    E('div', { 'class': 'pp-card-label' }, [label]),
    E('div', { 'class': 'pp-card-value' }, [value == null || value === '' ? '-' : String(value)]),
    sub ? E('div', { 'class': 'pp-card-sub' }, [sub]) : ''
  ]);
}

function textInput(id, value, type, extra) {
  var attrs = Object.assign({
    'class': 'cbi-input-text',
    'id': id,
    'type': type || 'text',
    'value': value || ''
  }, extra || {});
  return E('input', attrs);
}

function formItem(label, input, hint) {
  return E('div', { 'class': 'cbi-value' }, [
    E('label', { 'class': 'cbi-value-title' }, [label]),
    E('div', { 'class': 'cbi-value-field' }, [
      input,
      hint ? E('div', { 'class': 'pp-muted', 'style': 'font-size:12px;margin-top:5px;' }, [hint]) : ''
    ])
  ]);
}

function renderProxyRows(proxies) {
  proxies = proxies || [];
  if (!proxies.length)
    return E('em', {}, ['\u6682\u65e0\u53ef\u7528\u4ee3\u7406']);

  return E('table', { 'class': 'table' }, [
    E('tr', {}, [
      E('th', {}, ['\u4e0a\u6e38\u4ee3\u7406']),
      E('th', {}, ['\u5ef6\u8fdf']),
      E('th', {}, ['\u8bbe\u5907\u6570']),
      E('th', {}, ['\u5230\u671f\u65f6\u95f4'])
    ]),
    proxies.map(function(p) {
      return E('tr', {}, [
        E('td', {}, [p.ip + ':' + p.port]),
        E('td', {}, [(p.latency_ms || 0) + ' ms']),
        E('td', {}, [String(p.assigned_count || 0)]),
        E('td', {}, [p.expire || '-'])
      ]);
    })
  ]);
}

function renderBindingRows(bindings) {
  var rows = [];
  bindings = bindings || {};

  Object.keys(bindings).sort().forEach(function(mac) {
    var item = bindings[mac] || {};
    rows.push(E('tr', {}, [
      E('td', {}, [mac]),
      E('td', {}, [item.ip || '-']),
      E('td', {}, [item.hostname || '-']),
      E('td', {}, [item.proxy_key || '-']),
      E('td', {}, [item.last_seen || '-'])
    ]));
  });

  if (!rows.length)
    return E('em', {}, ['\u6682\u65e0\u624b\u673a\u7ed1\u5b9a\u8bb0\u5f55']);

  return E('table', { 'class': 'table' }, [
    E('tr', {}, [
      E('th', {}, ['MAC']),
      E('th', {}, ['\u5f53\u524d IP']),
      E('th', {}, ['\u8bbe\u5907\u540d']),
      E('th', {}, ['\u4ee3\u7406']),
      E('th', {}, ['\u6700\u540e\u51fa\u73b0'])
    ]),
    rows
  ]);
}

function renderWarnings(warnings) {
  warnings = warnings || [];
  if (!warnings.length)
    return '';

  return E('div', {
    'style': 'margin-top:12px;padding:10px;border:1px solid #e7d28b;background:#fff8d8;border-radius:8px;'
  }, [
    E('strong', {}, ['\u8b66\u544a:']),
    E('pre', { 'style': 'margin:8px 0 0;white-space:pre-wrap;' }, [warnings.join('\n')])
  ]);
}

function parseIpRows(text) {
  var rows = [];
  var lines = String(text || '').split(/\r?\n/);
  var today = new Date();
  today.setHours(0, 0, 0, 0);

  lines.forEach(function(raw, index) {
    var line = raw.trim();
    var row = {
      index: index,
      line_no: index + 1,
      raw: raw,
      ip: '',
      port: '',
      username: '',
      password: '',
      expire: '',
      status: '',
      valid: false,
      comment: false
    };

    if (!line)
      return;

    if (line.charAt(0) === '#') {
      row.status = '\u6ce8\u91ca';
      row.comment = true;
      rows.push(row);
      return;
    }

    var parts = line.split('|');
    if (parts.length < 4) {
      row.status = '\u683c\u5f0f\u9519\u8bef';
      rows.push(row);
      return;
    }

    row.ip = (parts[0] || '').trim();
    row.port = (parts[1] || '').trim();
    row.username = (parts[2] || '').trim();
    row.password = (parts[3] || '').trim();
    row.expire = (parts[4] || '').trim();
    row.valid = !!row.ip && !!row.port && !!row.username && !!row.password;
    row.status = row.valid ? '\u6709\u6548' : '\u53c2\u6570\u7f3a\u5931';

    if (row.valid && !/^\d+$/.test(row.port)) {
      row.valid = false;
      row.status = '\u7aef\u53e3\u9519\u8bef';
    }

    if (row.valid && row.expire) {
      var match = row.expire.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (match) {
        var expireDate = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
        if (expireDate < today) {
          row.valid = false;
          row.status = '\u5df2\u8fc7\u671f';
        }
      }
    }

    rows.push(row);
  });

  return rows;
}

function renderIpRows(rows, onDelete) {
  var validCount = 0;
  var invalidCount = 0;
  var commentCount = 0;

  rows.forEach(function(row) {
    if (row.valid)
      validCount++;
    else if (row.comment)
      commentCount++;
    else
      invalidCount++;
  });

  if (!rows.length)
    return E('div', {}, [
      E('div', { 'class': 'pp-summary' }, [
        E('span', { 'class': 'pp-pill' }, ['\u5df2\u89e3\u6790 0 \u6761'])
      ]),
      E('em', {}, ['IP.txt \u6682\u65e0\u5185\u5bb9'])
    ]);

  return E('div', {}, [
    E('div', { 'class': 'pp-summary' }, [
      E('span', { 'class': 'pp-pill' }, ['\u603b\u884c ' + rows.length]),
      E('span', { 'class': 'pp-pill pp-pill-good' }, ['\u6709\u6548 ' + validCount]),
      E('span', { 'class': 'pp-pill pp-pill-bad' }, ['\u9700\u68c0\u67e5 ' + invalidCount]),
      E('span', { 'class': 'pp-pill' }, ['\u6ce8\u91ca ' + commentCount])
    ]),
    E('table', { 'class': 'table' }, [
      E('tr', {}, [
        E('th', {}, ['#']),
        E('th', {}, ['IP']),
        E('th', {}, ['\u7aef\u53e3']),
        E('th', {}, ['\u8d26\u53f7']),
        E('th', {}, ['\u5bc6\u7801']),
        E('th', {}, ['\u5230\u671f\u65f6\u95f4']),
        E('th', {}, ['\u72b6\u6001']),
        E('th', {}, ['\u64cd\u4f5c'])
      ]),
      rows.map(function(row) {
        return E('tr', {}, [
          E('td', {}, [String(row.line_no)]),
          E('td', {}, [row.ip || row.raw || '-']),
          E('td', {}, [row.port || '-']),
          E('td', {}, [row.username || '-']),
          E('td', {}, [row.password ? '******' : '-']),
          E('td', {}, [row.expire || '-']),
          E('td', {}, [badge(row.status || '-', row.valid || row.comment)]),
          E('td', {}, [
            E('button', {
              'class': 'btn cbi-button cbi-button-remove',
              'click': function() {
                onDelete(row.index);
              }
            }, ['\u5220\u9664'])
          ])
        ]);
      })
    ])
  ]);
}

return view.extend({
  load: function() {
    return Promise.all([
      ctl(['status']),
      ctl(['settings'])
    ]).then(function(base) {
      var settings = base[1] || {};
      var ipPath = settings.ip_file || DEFAULT_IP_FILE;
      return fs.read(ipPath).catch(function() { return ''; }).then(function(text) {
        return [base[0] || {}, settings, text];
      });
    });
  },

  render: function(data) {
    var status = data[0] || {};
    var settings = data[1] || {};
    var ipText = data[2] || '';
    var ipPath = settings.ip_file || DEFAULT_IP_FILE;
    var enabled = !!settings.enabled;
    var daemonOnline = !!status.daemon_running || Object.keys(status).length > 0;
    var engineRunning = !!status.running;
    var ipFile = status.ip_file || {};
    var aliveCount = status.alive_proxy_count || 0;
    var assignedCount = status.assigned_device_count || 0;
    var ipTableBox = E('div', { 'id': 'pp-iptable', 'class': 'pp-table-wrap' });

    function redrawIpTable() {
      var node = document.getElementById('pp-iptable');
      if (!node)
        return;

      while (node.firstChild)
        node.removeChild(node.firstChild);

      node.appendChild(renderIpRows(parseIpRows(document.getElementById('pp-iptxt').value), deleteIpLine));
    }

    function deleteIpLine(index) {
      var input = document.getElementById('pp-iptxt');
      var lines = input.value.split(/\r?\n/);
      lines.splice(index, 1);
      input.value = lines.join('\n');
      redrawIpTable();
    }

    function loadLocalTxt(ev) {
      var file = ev.target.files && ev.target.files[0];
      if (!file)
        return;

      var reader = new FileReader();
      reader.onload = function(event) {
        document.getElementById('pp-iptxt').value = String(event.target.result || '').replace(/\r\n/g, '\n');
        redrawIpTable();
        ui.addNotification(null, E('p', {}, ['TXT \u5df2\u5bfc\u5165\uff0c\u786e\u8ba4\u540e\u70b9\u51fb\u4fdd\u5b58\u5e76\u5237\u65b0']));
      };
      reader.readAsText(file, 'utf-8');
    }

    var enabledInput = E('input', {
      'type': 'checkbox',
      'id': 'pp-enabled',
      'checked': enabled ? 'checked' : null
    });

    var portInput = textInput('pp-port', settings.listen_port || 10000, 'number', {
      'min': '1',
      'max': '65535'
    });

    var hostInput = textInput('pp-host', settings.advertised_host || '', 'text');
    var maxInput = textInput('pp-max-devices', settings.max_devices_per_proxy || 3, 'number', {
      'min': '1',
      'max': '200'
    });
    var ipFileInput = textInput('pp-ip-file', ipPath, 'text');

    var textArea = E('textarea', {
      'class': 'cbi-input-textarea pp-iptxt',
      'id': 'pp-iptxt',
      'input': redrawIpTable
    }, [ipText]);

    function saveSettings() {
      return ctl(['set',
        'enabled=' + document.getElementById('pp-enabled').checked,
        'listen_port=' + Number(document.getElementById('pp-port').value || 10000),
        'advertised_host=' + (document.getElementById('pp-host').value || ''),
        'max_devices_per_proxy=' + Number(document.getElementById('pp-max-devices').value || 3),
        'ip_file=' + (document.getElementById('pp-ip-file').value || DEFAULT_IP_FILE)
      ]).then(function() {
        ui.addNotification(null, E('p', {}, ['\u8bbe\u7f6e\u5df2\u4fdd\u5b58']));
        return location.reload();
      });
    }

    function saveIpText() {
      return fs.write(ipPath, document.getElementById('pp-iptxt').value).then(function() {
        return ctl(['reload']);
      }).then(function() {
        ui.addNotification(null, E('p', {}, ['\u4ee3\u7406\u6c60\u5df2\u66f4\u65b0']));
        return location.reload();
      });
    }

    function reloadPool() {
      return ctl(['reload']).then(function() {
        ui.addNotification(null, E('p', {}, ['\u5df2\u5237\u65b0']));
        return location.reload();
      });
    }

    function startPool() {
      return ctl(['enable']).then(function() {
        return ctl(['reload']);
      }).then(function() {
        ui.addNotification(null, E('p', {}, ['\u4ee3\u7406\u6c60\u5df2\u542f\u52a8']));
        return location.reload();
      });
    }

    function stopPool() {
      return ctl(['disable']).then(function() {
        ui.addNotification(null, E('p', {}, ['\u4ee3\u7406\u6c60\u5df2\u505c\u6b62']));
        return location.reload();
      });
    }

    ipTableBox.appendChild(renderIpRows(parseIpRows(ipText), deleteIpLine));

    return E('div', { 'class': 'cbi-map pp-root' }, [
      E('style', {}, [PP_STYLE]),

      E('div', { 'class': 'pp-hero' }, [
        E('div', { 'class': 'pp-brand' }, [
          E('img', { 'class': 'pp-logo', 'src': LOGO_URL, 'alt': 'Proxy Pool' }),
          E('div', {}, [
            E('div', { 'class': 'pp-title' }, ['Proxy Pool']),
            E('div', { 'class': 'pp-subtitle' }, ['\u624b\u673a\u7edf\u4e00\u4ee3\u7406\u5165\u53e3 / sing-box \u8f7b\u91cf\u5206\u6d41'])
          ])
        ]),
        E('div', { 'class': 'pp-hero-meta' }, [
          E('div', {}, ['\u624b\u673a\u4ee3\u7406: ', E('strong', {}, [status.advertised_proxy || '-'])]),
          E('div', {}, ['IP.txt: ', ipPath])
        ])
      ]),

      E('div', { 'class': 'cbi-section' }, [
        E('h3', {}, ['\u8fd0\u884c\u72b6\u6001']),
        E('div', { 'class': 'pp-status-grid' }, [
          metric('\u540e\u53f0\u670d\u52a1', daemonOnline ? '\u5728\u7ebf' : '\u79bb\u7ebf', daemonOnline ? 'good' : 'bad', 'Control API'),
          metric('\u8f6c\u53d1\u5f15\u64ce', engineRunning ? '\u8fd0\u884c\u4e2d' : '\u5df2\u505c\u6b62', engineRunning ? 'good' : 'warn', status.reason || 'sing-box'),
          metric('\u53ef\u7528\u4ee3\u7406', aliveCount, aliveCount > 0 ? 'good' : 'warn', '\u5065\u5eb7\u68c0\u6d4b\u901a\u8fc7'),
          metric('\u7ed1\u5b9a\u8bbe\u5907', assignedCount, assignedCount > 0 ? 'good' : 'neutral', '\u6309 MAC \u4fdd\u6301\u5206\u914d'),
          metric('DHCP \u79df\u7ea6', status.lease_count || 0, 'neutral', '\u6765\u81ea dnsmasq'),
          metric('IP.txt', (ipFile.data_lines || 0) + ' / ' + (ipFile.total_lines || 0), (ipFile.data_lines || 0) > 0 ? 'good' : 'warn', '\u6570\u636e\u884c / \u603b\u884c')
        ]),
        renderWarnings(status.warnings),
        E('div', { 'class': 'pp-actions' }, [
          E('button', {
            'class': 'btn cbi-button cbi-button-apply',
            'click': ui.createHandlerFn(this, startPool)
          }, ['\u542f\u52a8']),
          E('button', {
            'class': 'btn cbi-button cbi-button-remove',
            'click': ui.createHandlerFn(this, stopPool)
          }, ['\u505c\u6b62']),
          E('button', {
            'class': 'btn cbi-button cbi-button-reload',
            'click': ui.createHandlerFn(this, reloadPool)
          }, ['\u5237\u65b0'])
        ])
      ]),

      E('div', { 'class': 'cbi-section' }, [
        E('h3', {}, ['\u57fa\u7840\u8bbe\u7f6e']),
        E('div', { 'class': 'pp-form-grid' }, [
          formItem('\u542f\u7528', enabledInput),
          formItem('\u4ee3\u7406\u7aef\u53e3', portInput),
          formItem('\u663e\u793a\u5730\u5740', hostInput),
          formItem('\u6bcf\u4ee3\u7406\u8bbe\u5907\u6570', maxInput),
          formItem('IP.txt \u4fdd\u5b58\u8def\u5f84', ipFileInput, '\u53ef\u7528 /opt/proxy-pool/IP.txt \u4fdd\u5b58\u5728\u9879\u76ee\u76ee\u5f55')
        ]),
        E('div', { 'class': 'pp-actions' }, [
          E('button', {
            'class': 'btn cbi-button cbi-button-save',
            'click': ui.createHandlerFn(this, saveSettings)
          }, ['\u4fdd\u5b58\u8bbe\u7f6e'])
        ])
      ]),

      E('div', { 'class': 'cbi-section' }, [
        E('h3', {}, ['\u4ee3\u7406\u6c60 IP.txt']),
        E('div', { 'class': 'pp-upload-panel' }, [
          E('div', { 'class': 'pp-upload-row' }, [
            E('input', {
              'type': 'file',
              'accept': '.txt,text/plain',
              'id': 'pp-upload',
              'change': loadLocalTxt
            }),
            E('span', { 'class': 'pp-muted' }, ['\u9009\u62e9 TXT \u540e\u4f1a\u5148\u5bfc\u5165\u5230\u4e0b\u65b9\uff0c\u786e\u8ba4\u540e\u518d\u4fdd\u5b58'])
          ]),
          E('div', { 'class': 'pp-path' }, ['\u5f53\u524d\u4fdd\u5b58\u8def\u5f84: ', ipPath])
        ]),
        textArea,
        E('p', { 'class': 'pp-muted' }, ['\u683c\u5f0f: ip|port|username|password|expire_date']),
        ipTableBox,
        E('div', { 'class': 'pp-actions' }, [
          E('button', {
            'class': 'btn cbi-button cbi-button-save',
            'click': ui.createHandlerFn(this, saveIpText)
          }, ['\u4fdd\u5b58\u5e76\u5237\u65b0'])
        ])
      ]),

      E('div', { 'class': 'cbi-section' }, [
        E('h3', {}, ['\u53ef\u7528\u4ee3\u7406']),
        renderProxyRows(status.proxies)
      ]),

      E('div', { 'class': 'cbi-section' }, [
        E('h3', {}, ['\u624b\u673a\u7ed1\u5b9a']),
        renderBindingRows(status.bindings)
      ])
    ]);
  }
});
