# Quick Reference: Infrastructure Features

## 1. Session Store Usage

### For Developers
```javascript
// Sessions are automatic - just use req.session as normal
app.get('/api/data', (req, res) => {
  if (req.session.user) {
    req.session.viewCount = (req.session.viewCount || 0) + 1;
    res.json({ views: req.session.viewCount });
  }
});
```

### For Admins
**Access:** `/admin/system` → Sessions tab

**Actions:**
- View session count and status
- Refresh statistics
- Manually cleanup expired sessions

### Admin API
```bash
# Get session stats
curl http://localhost:3000/admin/api/sessions/stats \
  -H "Authorization: Bearer TOKEN"

# Cleanup expired sessions
curl -X POST http://localhost:3000/admin/api/sessions/cleanup \
  -H "Authorization: Bearer TOKEN"
```

---

## 2. Cache Manager Usage

### For Developers
```javascript
const cache = global.appCache;

// Simple cache
cache.set('user:123', userData, 5 * 60 * 1000); // 5 min TTL
const user = cache.get('user:123');

// Compute if not cached
const result = cache.getOrSet('expensive:key', () => {
  return doExpensiveWork();
}, 10 * 60 * 1000);

// Async compute
const data = await cache.getOrSetAsync('api:key', async () => {
  return await callExternalAPI();
}, 15 * 60 * 1000);

// Cache events
cache.on('evict', (key) => console.log(`Evicted: ${key}`));
cache.on('expired', (key) => console.log(`Expired: ${key}`));
cache.on('set', (key, value) => console.log(`Cached: ${key}`));

// Invalidate pattern
cache.invalidatePattern('user:.*'); // Remove all user:* keys
cache.invalidatePattern('api:users.*'); // Remove all API user keys

// Cleanup
cache.cleanup(); // Remove expired entries

// Get stats
const stats = cache.getStats();
console.log(`Hit rate: ${stats.hitRate}`);
```

### For Admins
**Access:** `/admin/system` → Cache tab

**Actions:**
- View cache size and hit rate
- Monitor hits vs misses
- Clear entire cache
- Reset statistics
- Manual cleanup

### Admin API
```bash
# Get cache stats
curl http://localhost:3000/admin/api/cache/stats

# View cache contents (dev only)
curl http://localhost:3000/admin/api/cache/debug

# Clear cache
curl -X POST http://localhost:3000/admin/api/cache/clear

# Reset stats
curl -X POST http://localhost:3000/admin/api/cache/reset-stats
```

### Best Practices
1. Use `getOrSetAsync` for API calls
2. Set appropriate TTLs (5-15 min typical)
3. Invalidate patterns on data changes
4. Monitor hit rate (aim for >70%)
5. Don't cache sensitive data in production

---

## 3. Plugin System Usage

### For Plugin Developers

**Step 1: Create plugin directory**
```
./plugins/my-plugin/
├── package.json
├── index.js
└── README.md
```

**Step 2: Create package.json**
```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "My custom plugin",
  "main": "index.js",
  "jellyfin": {
    "plugin": true,
    "hooks": [
      "before:auth",
      "after:user:create",
      "custom:myapp:action"
    ]
  }
}
```

**Step 3: Create plugin class**
```javascript
// index.js
class MyPlugin {
  constructor(api) {
    this.api = api;
    this.log = (msg) => console.log(`[MyPlugin] ${msg}`);
  }

  async onLoad() {
    this.log('Plugin loaded!');
    
    // Register hook listener
    this.api.registerHook('before:auth', this.beforeAuth.bind(this), 10);
    
    // Register middleware
    this.api.registerMiddleware(this.customMiddleware.bind(this), 10);
  }

  async onUnload() {
    this.log('Plugin unloaded');
  }

  beforeAuth(data) {
    this.log(`Auth attempt for: ${data.username}`);
    return data; // Must return data
  }

  customMiddleware(req, res, next) {
    req.pluginData = 'custom';
    next();
  }
}

module.exports = MyPlugin;
```

**Step 4: Register in app**
```javascript
// In your auth route
router.post('/login', async (req, res) => {
  const data = { username: req.body.username, password: req.body.password };
  
  // Execute hook
  const modifiedData = await PluginManager.executeHook('before:auth', data);
  
  // Continue with auth...
});
```

### Available Hooks

**Built-in Hooks:**
- `before:auth` - Before authentication attempt
- `after:auth` - After successful authentication
- `before:user:create` - Before creating user
- `after:user:create` - After user created
- `before:backup` - Before backup operation
- `after:backup` - After backup completed

**Custom Hooks:**
Plugins can define and execute their own hooks.

### For Admins
**Access:** `/admin/system` → Plugins tab

**Actions:**
- View all loaded plugins
- See plugin versions and status
- View registered hooks
- Reload all plugins
- Unload individual plugins

### Admin API
```bash
# List plugins
curl http://localhost:3000/admin/api/plugins

# View hooks
curl http://localhost:3000/admin/api/plugins/hooks

# Reload plugins
curl -X POST http://localhost:3000/admin/api/plugins/reload

# Unload specific plugin
curl -X POST http://localhost:3000/admin/api/plugins/my-plugin/unload
```

### Plugin Best Practices
1. Always return data from hooks
2. Handle errors gracefully
3. Log important operations
4. Clean up resources in onUnload
5. Use priority (higher = earlier execution)
6. Avoid blocking operations

---

## Performance Monitoring

### Check Session Store Health
```bash
curl http://localhost:3000/admin/api/sessions/stats | jq
```

**Healthy Stats:**
- active: High during peak hours
- expired: Cleanup running regularly
- No error messages

### Check Cache Health
```bash
curl http://localhost:3000/admin/api/cache/stats | jq
```

**Healthy Stats:**
- hitRate: >70%
- size: Growing but < maxSize
- No memory warnings

### Check Plugin Health
```bash
curl http://localhost:3000/admin/api/plugins | jq
```

**Healthy Stats:**
- All plugins: status = "loaded"
- No error logs in console
- Hooks executing successfully

---

## Troubleshooting

### Sessions Not Persisting
**Problem:** Sessions lost on server restart
**Solution:** Ensure SessionStore is initialized
```javascript
// Check in server.js
const sessionStore = new SessionStore({ ... });
app.use(session({ store: sessionStore, ... }));
```

### Cache Hit Rate Low
**Problem:** Cache hits < 50%
**Solutions:**
1. Increase TTL for longer caching
2. Use better cache keys
3. Preload frequently accessed data
4. Check if data changes frequently

### Plugins Not Loading
**Problem:** Plugins not showing in admin
**Solutions:**
1. Check plugin directory: `./plugins/`
2. Verify package.json exists
3. Check `jellyfin.plugin: true`
4. Look for errors in console
5. Reload plugins from admin panel

---

## Environment Variables

```bash
# Session configuration
SESSION_SECRET=your-secret-key
SESSION_TIMEOUT=86400000  # milliseconds

# Cache configuration
CACHE_TTL=300000          # default TTL (milliseconds)
CACHE_MAX_SIZE=1000       # max entries

# Plugin configuration
PLUGIN_DIR=./plugins      # plugin directory
PLUGIN_AUTO_LOAD=true     # auto-discover on startup

# Performance
NODE_ENV=production       # Enable optimizations
```

---

## Migration from In-Memory Sessions

If upgrading from in-memory sessions:

1. **Backup:** Save current session data
2. **Update:** Deploy new SessionStore code
3. **Migrate:** Sessions automatically migrated to DB
4. **Verify:** Check admin panel session stats
5. **Monitor:** Watch for session issues

No manual migration needed - SessionStore handles it!

---

## Common Code Patterns

### Cache User Data
```javascript
app.get('/api/user/:id', async (req, res) => {
  const user = await cache.getOrSetAsync(
    `user:${req.params.id}`,
    () => jellyfin.getUser(req.params.id),
    5 * 60 * 1000 // 5 minutes
  );
  res.json(user);
});
```

### Invalidate on Create
```javascript
app.post('/api/users', async (req, res) => {
  const user = await jellyfin.createUser(req.body);
  
  // Invalidate related caches
  cache.invalidatePattern('users:.*');
  cache.invalidatePattern('user:list');
  
  res.json(user);
});
```

### Hook-Based Logging
```javascript
PluginManager.on('plugin:loaded', (data) => {
  console.log(`Plugin loaded: ${data.name}`);
  AuditLogger.log('PLUGIN_LOADED', 'system', data.name);
});
```

---

## Performance Impact

### Session Store
- **Memory:** ~1KB per session (DB)
- **Disk:** 100+ sessions = ~100KB DB growth
- **Cleanup:** Runs hourly, <100ms typical

### Cache Manager
- **Memory:** ~10KB base + ~100 bytes per entry
- **CPU:** <5ms for cache hit
- **Eviction:** LRU cleanup on demand

### Plugin System
- **Startup:** +100-500ms for discovery/loading
- **Hook Exec:** <1ms per hook (typical)
- **Memory:** ~1-5MB per plugin

**Bottom Line:** All optimized for production use!
