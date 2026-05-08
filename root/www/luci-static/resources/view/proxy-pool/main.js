'use strict';
'require view';
'require fs';
'require ui';

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

function field(label, value) {
  var display = value;
  if (display == null || display === '')
    display = '-';

  var children = [E('strong', {}, [label + ': '])];
  if (typeof display === 'object')
    children.push(display);
  else
    children.push(String(display));

  return E('div', { 'style': 'margin: 6px 0;' }, [
    E('span', {}, children)
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
    'style': 'margin-top:12px;padding:10px;border:1px solid #e7d28b;background:#fff8d8;'
  }, [
    E('strong', {}, ['\u8b66\u544a:']),
    E('pre', { 'style': 'margin:8px 0 0;white-space:pre-wrap;' }, [warnings.join('\n')])
  ]);
}

return view.extend({
  load: function() {
    return Promise.all([
      ctl(['status']),
      ctl(['settings']),
      fs.read('/overlay/share/IP.txt').catch(function() { return ''; })
    ]);
  },

  render: function(data) {
    var status = data[0] || {};
    var settings = data[1] || {};
    var ipText = data[2] || '';
    var enabled = !!settings.enabled;
    var daemonOnline = !!status.daemon_running || Object.keys(status).length > 0;
    var engineRunning = !!status.running;
    var ipFile = status.ip_file || {};

    var enabledInput = E('input', {
      'type': 'checkbox',
      'id': 'pp-enabled',
      'checked': enabled ? 'checked' : null
    });

    var portInput = E('input', {
      'class': 'cbi-input-text',
      'id': 'pp-port',
      'type': 'number',
      'min': '1',
      'max': '65535',
      'value': settings.listen_port || 10000
    });

    var hostInput = E('input', {
      'class': 'cbi-input-text',
      'id': 'pp-host',
      'type': 'text',
      'value': settings.advertised_host || ''
    });

    var maxInput = E('input', {
      'class': 'cbi-input-text',
      'id': 'pp-max-devices',
      'type': 'number',
      'min': '1',
      'max': '200',
      'value': settings.max_devices_per_proxy || 3
    });

    var textArea = E('textarea', {
      'class': 'cbi-input-textarea',
      'id': 'pp-iptxt',
      'style': 'width:100%; min-height:220px; font-family:monospace;'
    }, [ipText]);

    function saveSettings() {
      return ctl(['set',
        'enabled=' + document.getElementById('pp-enabled').checked,
        'listen_port=' + Number(document.getElementById('pp-port').value || 10000),
        'advertised_host=' + (document.getElementById('pp-host').value || ''),
        'max_devices_per_proxy=' + Number(document.getElementById('pp-max-devices').value || 3)
      ]).then(function() {
        ui.addNotification(null, E('p', {}, ['\u8bbe\u7f6e\u5df2\u4fdd\u5b58']));
        return location.reload();
      });
    }

    function saveIpText() {
      return fs.write('/overlay/share/IP.txt', document.getElementById('pp-iptxt').value).then(function() {
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

    return E('div', { 'class': 'cbi-map' }, [
      E('h2', {}, ['Proxy Pool']),

      E('div', { 'class': 'cbi-section' }, [
        E('h3', {}, ['\u8fd0\u884c\u72b6\u6001']),
        E('div', { 'style': 'display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;' }, [
          E('div', {}, [
            field('\u540e\u53f0\u670d\u52a1', badge(daemonOnline ? '\u5728\u7ebf' : '\u79bb\u7ebf', daemonOnline)),
            field('\u8f6c\u53d1\u5f15\u64ce', badge(engineRunning ? '\u8fd0\u884c\u4e2d' : '\u5df2\u505c\u6b62', engineRunning)),
            field('\u5df2\u542f\u7528', enabled ? '\u662f' : '\u5426')
          ]),
          E('div', {}, [
            field('\u624b\u673a\u4ee3\u7406', status.advertised_proxy || '-'),
            field('\u76d1\u542c\u5730\u5740', status.listen || '-'),
            field('\u539f\u56e0', status.reason || '-')
          ]),
          E('div', {}, [
            field('\u53ef\u7528\u4ee3\u7406', status.alive_proxy_count || 0),
            field('\u7ed1\u5b9a\u8bbe\u5907', status.assigned_device_count || 0),
            field('DHCP \u79df\u7ea6', status.lease_count || 0),
            field('IP.txt \u884c\u6570', (ipFile.data_lines || 0) + ' \u6570\u636e / ' + (ipFile.total_lines || 0) + ' \u603b\u884c')
          ])
        ]),
        renderWarnings(status.warnings),
        E('div', { 'style': 'margin-top:14px;' }, [
          E('button', {
            'class': 'btn cbi-button cbi-button-apply',
            'click': ui.createHandlerFn(this, startPool)
          }, ['\u542f\u52a8']),
          ' ',
          E('button', {
            'class': 'btn cbi-button cbi-button-remove',
            'click': ui.createHandlerFn(this, stopPool)
          }, ['\u505c\u6b62']),
          ' ',
          E('button', {
            'class': 'btn cbi-button cbi-button-reload',
            'click': ui.createHandlerFn(this, reloadPool)
          }, ['\u5237\u65b0'])
        ])
      ]),

      E('div', { 'class': 'cbi-section' }, [
        E('h3', {}, ['\u57fa\u7840\u8bbe\u7f6e']),
        E('div', { 'class': 'cbi-value' }, [
          E('label', { 'class': 'cbi-value-title' }, ['\u542f\u7528']),
          E('div', { 'class': 'cbi-value-field' }, [enabledInput])
        ]),
        E('div', { 'class': 'cbi-value' }, [
          E('label', { 'class': 'cbi-value-title' }, ['\u4ee3\u7406\u7aef\u53e3']),
          E('div', { 'class': 'cbi-value-field' }, [portInput])
        ]),
        E('div', { 'class': 'cbi-value' }, [
          E('label', { 'class': 'cbi-value-title' }, ['\u663e\u793a\u5730\u5740']),
          E('div', { 'class': 'cbi-value-field' }, [hostInput])
        ]),
        E('div', { 'class': 'cbi-value' }, [
          E('label', { 'class': 'cbi-value-title' }, ['\u6bcf\u4ee3\u7406\u8bbe\u5907\u6570']),
          E('div', { 'class': 'cbi-value-field' }, [maxInput])
        ]),
        E('button', {
          'class': 'btn cbi-button cbi-button-save',
          'click': ui.createHandlerFn(this, saveSettings)
        }, ['\u4fdd\u5b58\u8bbe\u7f6e'])
      ]),

      E('div', { 'class': 'cbi-section' }, [
        E('h3', {}, ['\u4ee3\u7406\u6c60 IP.txt']),
        textArea,
        E('p', {}, ['\u683c\u5f0f: ip|port|username|password|expire_date']),
        E('button', {
          'class': 'btn cbi-button cbi-button-save',
          'click': ui.createHandlerFn(this, saveIpText)
        }, ['\u4fdd\u5b58\u5e76\u5237\u65b0'])
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
