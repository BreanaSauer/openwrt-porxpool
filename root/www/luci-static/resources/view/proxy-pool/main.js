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

function statusBadge(text, good) {
  return E('span', {
    'class': good ? 'label label-success' : 'label label-warning'
  }, [text]);
}

function renderProxyRows(proxies) {
  proxies = proxies || [];
  if (!proxies.length)
    return E('em', {}, _('暂无可用代理'));

  return E('table', { 'class': 'table' }, [
    E('tr', {}, [
      E('th', {}, _('上游代理')),
      E('th', {}, _('延迟')),
      E('th', {}, _('绑定设备')),
      E('th', {}, _('到期'))
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
    return E('em', {}, _('暂无手机绑定记录'));

  return E('table', { 'class': 'table' }, [
    E('tr', {}, [
      E('th', {}, _('MAC')),
      E('th', {}, _('当前 IP')),
      E('th', {}, _('设备名')),
      E('th', {}, _('代理')),
      E('th', {}, _('最后出现'))
    ]),
    rows
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
    var running = !!status.running;

    var enabledInput = E('input', {
      'type': 'checkbox',
      'id': 'pp-enabled',
      'checked': settings.enabled ? 'checked' : null
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
      var patch = {
        enabled: document.getElementById('pp-enabled').checked,
        listen_port: Number(document.getElementById('pp-port').value || 10000),
        advertised_host: document.getElementById('pp-host').value || '',
        max_devices_per_proxy: Number(document.getElementById('pp-max-devices').value || 3)
      };

      return ctl(['set',
        'enabled=' + patch.enabled,
        'listen_port=' + patch.listen_port,
        'advertised_host=' + patch.advertised_host,
        'max_devices_per_proxy=' + patch.max_devices_per_proxy
      ]).then(function() {
        ui.addNotification(null, E('p', {}, _('设置已保存')));
        return location.reload();
      });
    }

    function saveIpText() {
      return fs.write('/overlay/share/IP.txt', document.getElementById('pp-iptxt').value).then(function() {
        return ctl(['reload']);
      }).then(function() {
        ui.addNotification(null, E('p', {}, _('代理池已更新')));
        return location.reload();
      });
    }

    function reloadPool() {
      return ctl(['reload']).then(function() {
        ui.addNotification(null, E('p', {}, _('已刷新')));
        return location.reload();
      });
    }

    return E('div', { 'class': 'cbi-map' }, [
      E('h2', {}, _('Proxy Pool')),
      E('div', { 'class': 'cbi-section' }, [
        E('h3', {}, _('运行状态')),
        E('p', {}, [
          _('服务状态') + ': ',
          statusBadge(running ? _('运行中') : _('未运行'), running),
          ' ',
          _('手机代理') + ': ',
          E('strong', {}, [status.advertised_proxy || '-'])
        ]),
        E('p', {}, [
          _('可用代理') + ': ' + (status.alive_proxy_count || 0) + ' / ',
          _('已绑定设备') + ': ' + (status.assigned_device_count || 0) + ' / ',
          _('原因') + ': ' + (status.reason || '-')
        ]),
        E('div', { 'class': 'right' }, [
          E('button', {
            'class': 'btn cbi-button cbi-button-reload',
            'click': ui.createHandlerFn(this, reloadPool)
          }, _('刷新'))
        ])
      ]),

      E('div', { 'class': 'cbi-section' }, [
        E('h3', {}, _('基础设置')),
        E('div', { 'class': 'cbi-value' }, [
          E('label', { 'class': 'cbi-value-title' }, _('启用')),
          E('div', { 'class': 'cbi-value-field' }, [enabledInput])
        ]),
        E('div', { 'class': 'cbi-value' }, [
          E('label', { 'class': 'cbi-value-title' }, _('代理端口')),
          E('div', { 'class': 'cbi-value-field' }, [portInput])
        ]),
        E('div', { 'class': 'cbi-value' }, [
          E('label', { 'class': 'cbi-value-title' }, _('显示地址')),
          E('div', { 'class': 'cbi-value-field' }, [hostInput])
        ]),
        E('div', { 'class': 'cbi-value' }, [
          E('label', { 'class': 'cbi-value-title' }, _('每代理设备数')),
          E('div', { 'class': 'cbi-value-field' }, [maxInput])
        ]),
        E('button', {
          'class': 'btn cbi-button cbi-button-save',
          'click': ui.createHandlerFn(this, saveSettings)
        }, _('保存设置'))
      ]),

      E('div', { 'class': 'cbi-section' }, [
        E('h3', {}, _('代理池 IP.txt')),
        textArea,
        E('p', {}, _('格式：ip|port|username|password|expire_date')),
        E('button', {
          'class': 'btn cbi-button cbi-button-save',
          'click': ui.createHandlerFn(this, saveIpText)
        }, _('保存并刷新'))
      ]),

      E('div', { 'class': 'cbi-section' }, [
        E('h3', {}, _('可用代理')),
        renderProxyRows(status.proxies)
      ]),

      E('div', { 'class': 'cbi-section' }, [
        E('h3', {}, _('手机绑定')),
        renderBindingRows(status.bindings)
      ])
    ]);
  }
});
