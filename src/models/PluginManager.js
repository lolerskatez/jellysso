const fs = require('fs').promises;
const path = require('path');
const EventEmitter = require('events');

/**
 * Enhanced Plugin System
 * Enables third-party extensibility with hooks and plugin discovery
 */
class PluginManager extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = {
      pluginDir: options.pluginDir || path.join(__dirname, '../../plugins'),
      enableAutoLoad: options.enableAutoLoad !== false,
      enableSandbox: options.enableSandbox !== false,
      ...options
    };

    this.plugins = new Map(); // Loaded plugins
    this.hooks = new Map(); // Hook listeners
    this.middleware = []; // Plugin middleware
    this.initialized = false;
  }

  /**
   * Initialize plugin system
   */
  async initialize() {
    try {
      // Create plugins directory if it doesn't exist
      try {
        await fs.access(this.options.pluginDir);
      } catch {
        await fs.mkdir(this.options.pluginDir, { recursive: true });
      }

      // Auto-load plugins from directory
      if (this.options.enableAutoLoad) {
        await this.discoverPlugins();
      }

      this.initialized = true;
      this.emit('initialized');
      console.log('✅ Plugin system initialized');
      return true;
    } catch (error) {
      console.error('Plugin system initialization failed:', error);
      throw error;
    }
  }

  /**
   * Discover and load plugins from directory
   */
  async discoverPlugins() {
    try {
      const files = await fs.readdir(this.options.pluginDir);
      const pluginDirs = files.filter(f => !f.startsWith('.'));

      for (const dir of pluginDirs) {
        const packageJsonPath = path.join(this.options.pluginDir, dir, 'package.json');
        
        try {
          const config = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));
          
          // Validate plugin structure
          if (config.jellyfin?.plugin) {
            await this.loadPlugin(dir, config);
          }
        } catch (error) {
          console.warn(`Failed to load plugin ${dir}:`, error.message);
        }
      }

      console.log(`📦 Discovered ${this.plugins.size} plugins`);
    } catch (error) {
      console.error('Plugin discovery failed:', error);
    }
  }

  /**
   * Load a specific plugin
   */
  async loadPlugin(pluginName, config) {
    try {
      const pluginPath = path.join(this.options.pluginDir, pluginName);
      const mainFile = path.join(pluginPath, config.main || 'index.js');

      // Load plugin module
      delete require.cache[require.resolve(mainFile)]; // Clear cache
      const Plugin = require(mainFile);

      // Validate plugin interface
      if (typeof Plugin !== 'function' && !Plugin.default) {
        throw new Error('Plugin must export a class or function');
      }

      const PluginClass = Plugin.default || Plugin;
      const instance = new PluginClass(this.createPluginAPI());

      // Call plugin lifecycle hook
      if (instance.onLoad) {
        await instance.onLoad();
      }

      // Register plugin
      this.plugins.set(pluginName, {
        instance,
        config,
        path: pluginPath,
        status: 'loaded',
        loadedAt: new Date()
      });

      this.emit('plugin:loaded', { name: pluginName, config });
      console.log(`✨ Plugin loaded: ${pluginName} v${config.version}`);
      return true;
    } catch (error) {
      console.error(`Failed to load plugin ${pluginName}:`, error);
      this.emit('plugin:error', { name: pluginName, error });
      throw error;
    }
  }

  /**
   * Unload a plugin
   */
  async unloadPlugin(pluginName) {
    const plugin = this.plugins.get(pluginName);
    if (!plugin) throw new Error(`Plugin ${pluginName} not found`);

    try {
      // Call plugin lifecycle hook
      if (plugin.instance.onUnload) {
        await plugin.instance.onUnload();
      }

      // Remove hooks registered by this plugin
      for (const [hookName, listeners] of this.hooks) {
        this.hooks.set(hookName, listeners.filter(l => l.plugin !== pluginName));
      }

      this.plugins.delete(pluginName);
      this.emit('plugin:unloaded', { name: pluginName });
      console.log(`🗑️  Plugin unloaded: ${pluginName}`);
      return true;
    } catch (error) {
      console.error(`Failed to unload plugin ${pluginName}:`, error);
      throw error;
    }
  }

  /**
   * Register a hook listener
   */
  registerHook(hookName, callback, priority = 10) {
    if (!this.hooks.has(hookName)) {
      this.hooks.set(hookName, []);
    }

    const listener = {
      callback,
      priority,
      plugin: callback.plugin || 'system'
    };

    const listeners = this.hooks.get(hookName);
    listeners.push(listener);
    listeners.sort((a, b) => b.priority - a.priority); // Sort by priority (higher first)

    return () => {
      const idx = listeners.indexOf(listener);
      if (idx > -1) listeners.splice(idx, 1);
    };
  }

  /**
   * Execute hook - call all listeners
   */
  async executeHook(hookName, data = {}) {
    const listeners = this.hooks.get(hookName) || [];
    let result = data;

    for (const listener of listeners) {
      try {
        result = await listener.callback(result);
      } catch (error) {
        console.error(`Hook error in ${hookName}:`, error);
        this.emit('hook:error', { hook: hookName, error });
      }
    }

    return result;
  }

  /**
   * Register plugin middleware
   */
  registerMiddleware(middleware, priority = 10) {
    this.middleware.push({ middleware, priority });
    this.middleware.sort((a, b) => b.priority - a.priority);
  }

  /**
   * Get middleware chain
   */
  getMiddlewareChain() {
    return this.middleware.map(m => m.middleware);
  }

  /**
   * Create API object for plugins
   */
  createPluginAPI() {
    return {
      registerHook: (name, cb, priority) => this.registerHook(name, cb, priority),
      executeHook: (name, data) => this.executeHook(name, data),
      registerMiddleware: (mw, priority) => this.registerMiddleware(mw, priority),
      on: (event, cb) => this.on(event, cb),
      emit: (event, data) => this.emit(event, data)
    };
  }

  /**
   * Get plugin list
   */
  getPlugins() {
    return Array.from(this.plugins.entries()).map(([name, plugin]) => ({
      name,
      version: plugin.config.version,
      status: plugin.status,
      loadedAt: plugin.loadedAt,
      description: plugin.config.description
    }));
  }

  /**
   * Get plugin by name
   */
  getPlugin(pluginName) {
    return this.plugins.get(pluginName);
  }

  /**
   * Get hook listeners
   */
  getHooks() {
    const hookInfo = {};
    for (const [name, listeners] of this.hooks) {
      hookInfo[name] = listeners.map(l => ({
        plugin: l.plugin,
        priority: l.priority
      }));
    }
    return hookInfo;
  }

  /**
   * Get system stats
   */
  getStats() {
    return {
      pluginsLoaded: this.plugins.size,
      hooksRegistered: this.hooks.size,
      middlewareCount: this.middleware.length,
      initialized: this.initialized,
      plugins: this.getPlugins()
    };
  }

  /**
   * Plugin manifest validation
   */
  validateManifest(manifest) {
    const required = ['name', 'version', 'jellyfin'];
    for (const field of required) {
      if (!manifest[field]) {
        throw new Error(`Missing required field: ${field}`);
      }
    }

    if (!manifest.jellyfin.plugin) {
      throw new Error('Missing jellyfin.plugin configuration');
    }

    return true;
  }
}

module.exports = new PluginManager();
