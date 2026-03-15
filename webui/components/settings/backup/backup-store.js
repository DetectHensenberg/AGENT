import { createStore } from "/js/AlpineStore.js";

// Global function references
const sendJsonData = globalThis.sendJsonData;
const toast = globalThis.toast;
const fetchApi = globalThis.fetchApi;

// ⚠️ CRITICAL: The .env file contains API keys and essential configuration.
// This file is REQUIRED for Agent Zero to function and must be backed up.

const model = {
  // State
  mode: 'backup', // 'backup' or 'restore'
  loading: false,
  loadingMessage: '',
  error: '',

  // File operations log (shared between backup and restore)
  fileOperationsLog: '',

  // Backup state
  backupMetadataConfig: null,
  includeHidden: false,
  previewStats: { total: 0, truncated: false },
  backupEditor: null,

  // Enhanced file preview state
  previewMode: 'grouped', // 'grouped' or 'flat'
  previewFiles: [],
  previewGroups: [],
  filteredPreviewFiles: [],
  fileSearchFilter: '',
  expandedGroups: new Set(),

  // Progress state
  progressData: null,
  progressEventSource: null,

  // Restore state
  backupFile: null,
  backupMetadata: null,
  restorePatterns: '',
  overwritePolicy: 'overwrite',
  cleanBeforeRestore: false,
  restoreEditor: null,
  restoreResult: null,

  // Initialization
  async initBackup() {
    this.mode = 'backup';
    this.resetState();
    await this.initBackupEditor();
    await this.updatePreview();
  },

  async initRestore() {
    this.mode = 'restore';
    this.resetState();
    await this.initRestoreEditor();
  },

  resetState() {
    this.loading = false;
    this.error = '';
    this.backupFile = null;
    this.backupMetadata = null;
    this.restoreResult = null;
    this.fileOperationsLog = '';
  },

  // File operations logging
  addFileOperation(message) {
    const timestamp = new Date().toLocaleTimeString();
    this.fileOperationsLog += `[${timestamp}] ${message}\n`;

    // Auto-scroll to bottom - use setTimeout since $nextTick is not available in stores
    setTimeout(() => {
      const textarea = document.getElementById(this.mode === 'backup' ? 'backup-file-list' : 'restore-file-list');
      if (textarea) {
        textarea.scrollTop = textarea.scrollHeight;
      }
    }, 0);
  },

  clearFileOperations() {
    this.fileOperationsLog = '';
  },

  // Cleanup method for modal close
  onClose() {
    this.resetState();
    if (this.backupEditor) {
      this.backupEditor.destroy();
      this.backupEditor = null;
    }
    if (this.restoreEditor) {
      this.restoreEditor.destroy();
      this.restoreEditor = null;
    }
  },

  // Get default backup metadata with resolved patterns from backend
  async getDefaultBackupMetadata() {
    const timestamp = new Date().toISOString();

    try {
      // Get resolved default patterns from backend
      const response = await sendJsonData("backup_get_defaults", {});

      if (response.success) {
        // Use patterns from backend with resolved absolute paths
        const include_patterns = response.default_patterns.include_patterns;
        const exclude_patterns = response.default_patterns.exclude_patterns;

        return {
          backup_name: `agent-zero-backup-${timestamp.slice(0, 10)}`,
          include_hidden: true,
          include_patterns: include_patterns,
          exclude_patterns: exclude_patterns,
          backup_config: {
            compression_level: 6,
            integrity_check: true
          }
        };
      }
    } catch (error) {
      console.warn("Failed to get default patterns from backend, using fallback");
    }

    // Fallback patterns (will be overridden by backend on first use)
    return {
      backup_name: `agent-zero-backup-${timestamp.slice(0, 10)}`,
      include_hidden: true,
      include_patterns: [
        // These will be replaced with resolved absolute paths by backend
        "# Loading default patterns from backend..."
      ],
      exclude_patterns: [],
      backup_config: {
        compression_level: 6,
        integrity_check: true
      }
    };
  },

  // Editor Management - Following Agent Zero ACE editor patterns
  async initBackupEditor() {
    const container = document.getElementById("backup-metadata-editor");
    if (container) {
      const editor = ace.edit("backup-metadata-editor");

      const dark = localStorage.getItem("darkMode");
      if (dark != "false") {
        editor.setTheme("ace/theme/github_dark");
      } else {
        editor.setTheme("ace/theme/tomorrow");
      }

      editor.session.setMode("ace/mode/json");

      // Initialize with default backup metadata
      const defaultMetadata = await this.getDefaultBackupMetadata();
      editor.setValue(JSON.stringify(defaultMetadata, null, 2));
      editor.clearSelection();

      // Auto-update preview on changes (debounced)
      let timeout;
      editor.on('change', () => {
        clearTimeout(timeout);
        timeout = setTimeout(() => {
          this.updatePreview();
        }, 1000);
      });

      this.backupEditor = editor;
    }
  },

  async initRestoreEditor() {
    const container = document.getElementById("restore-metadata-editor");
    if (container) {
      const editor = ace.edit("restore-metadata-editor");

      const dark = localStorage.getItem("darkMode");
      if (dark != "false") {
        editor.setTheme("ace/theme/github_dark");
      } else {
        editor.setTheme("ace/theme/tomorrow");
      }

      editor.session.setMode("ace/mode/json");
      editor.setValue('{}');
      editor.clearSelection();

      // Auto-validate JSON on changes
      editor.on('change', () => {
        this.validateRestoreMetadata();
      });

      this.restoreEditor = editor;
    }
  },

  // Unified editor value getter (following MCP servers pattern)
  getEditorValue() {
    const editor = this.mode === 'backup' ? this.backupEditor : this.restoreEditor;
    return editor ? editor.getValue() : '{}';
  },

  // Unified JSON formatting (following MCP servers pattern)
  formatJson() {
    const editor = this.mode === 'backup' ? this.backupEditor : this.restoreEditor;
    if (!editor) return;

    try {
      const currentContent = editor.getValue();
      const parsed = JSON.parse(currentContent);
      const formatted = JSON.stringify(parsed, null, 2);

      editor.setValue(formatted);
      editor.clearSelection();
      editor.navigateFileStart();
    } catch (error) {
      console.error("Failed to format JSON:", error);
      this.error = "无效的 JSON: " + error.message;
    }
  },

  // Enhanced File Preview Operations
  async updatePreview() {
    try {
      const metadataText = this.getEditorValue();
      const metadata = JSON.parse(metadataText);

      if (!metadata.include_patterns || metadata.include_patterns.length === 0) {
        this.previewStats = { total: 0, truncated: false };
        this.previewFiles = [];
        this.previewGroups = [];
        return;
      }

      // Convert patterns arrays back to string format for API
      const patternsString = this.convertPatternsToString(metadata.include_patterns, metadata.exclude_patterns);

      // Get grouped preview for better UX
      const response = await sendJsonData("backup_preview_grouped", {
        patterns: patternsString,
        include_hidden: metadata.include_hidden ?? true,
        max_depth: 3,
        search_filter: this.fileSearchFilter
      });

      if (response.success) {
        this.previewGroups = response.groups;
        this.previewStats = response.stats;

        // Flatten groups for flat view
        this.previewFiles = [];
        response.groups.forEach(group => {
          this.previewFiles.push(...group.files);
        });

        this.applyFileSearch();
      } else {
        this.error = response.error;
      }
    } catch (error) {
      this.error = `预览错误: ${error.message}`;
    }
  },

  // Convert pattern arrays to string format for backend API
  convertPatternsToString(includePatterns, excludePatterns) {
    const patterns = [];

    // Add include patterns
    if (includePatterns) {
      patterns.push(...includePatterns);
    }

    // Add exclude patterns with '!' prefix
    if (excludePatterns) {
      excludePatterns.forEach(pattern => {
        patterns.push(`!${pattern}`);
      });
    }

    return patterns.join('\n');
  },

  // Validation for backup metadata
  validateBackupMetadata() {
    try {
      const metadataText = this.getEditorValue();
      const metadata = JSON.parse(metadataText);

      // Validate required fields
      if (!Array.isArray(metadata.include_patterns)) {
        throw new Error('include_patterns must be an array');
      }
      if (!Array.isArray(metadata.exclude_patterns)) {
        throw new Error('exclude_patterns must be an array');
      }
      if (!metadata.backup_name || typeof metadata.backup_name !== 'string') {
        throw new Error('backup_name must be a non-empty string');
      }

      this.backupMetadataConfig = metadata;
      this.error = '';
      return true;
    } catch (error) {
      this.error = `无效的备份元数据: ${error.message}`;
      return false;
    }
  },

  // File Preview UI Management
  initFilePreview() {
    this.fileSearchFilter = '';
    this.expandedGroups.clear();
    this.previewMode = localStorage.getItem('backupPreviewMode') || 'grouped';
  },

  togglePreviewMode() {
    this.previewMode = this.previewMode === 'grouped' ? 'flat' : 'grouped';
    localStorage.setItem('backupPreviewMode', this.previewMode);
  },

  toggleGroup(groupPath) {
    if (this.expandedGroups.has(groupPath)) {
      this.expandedGroups.delete(groupPath);
    } else {
      this.expandedGroups.add(groupPath);
    }
  },

  isGroupExpanded(groupPath) {
    return this.expandedGroups.has(groupPath);
  },

  debounceFileSearch() {
    clearTimeout(this.searchTimeout);
    this.searchTimeout = setTimeout(() => {
      this.applyFileSearch();
    }, 300);
  },

  clearFileSearch() {
    this.fileSearchFilter = '';
    this.applyFileSearch();
  },

  applyFileSearch() {
    if (!this.fileSearchFilter.trim()) {
      this.filteredPreviewFiles = this.previewFiles;
    } else {
      const search = this.fileSearchFilter.toLowerCase();
      this.filteredPreviewFiles = this.previewFiles.filter(file =>
        file.path.toLowerCase().includes(search)
      );
    }
  },

  async exportFileList() {
    const fileList = this.previewFiles.map(f => f.path).join('\n');
    const blob = new Blob([fileList], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'backup-file-list.txt';
    a.click();
    URL.revokeObjectURL(url);
  },

  async copyFileListToClipboard() {
    const fileList = this.previewFiles.map(f => f.path).join('\n');
    try {
      await navigator.clipboard.writeText(fileList);
      window.toastFrontendInfo('文件列表已复制到剪贴板', '剪贴板');
    } catch (error) {
      window.toastFrontendError('复制到剪贴板失败', '剪贴板错误');
    }
  },

  // Backup Creation using direct API call
  async createBackup() {
    // Validate backup metadata first
    if (!this.validateBackupMetadata()) {
      return;
    }

    try {
      this.loading = true;
      this.loadingMessage = '正在创建备份...';
      this.error = '';
      this.clearFileOperations();
      this.addFileOperation('开始创建备份...');

      const metadata = this.backupMetadataConfig;

      // Use fetch directly since backup_create returns a file download, not JSON
      const response = await fetchApi('/backup_create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          include_patterns: metadata.include_patterns,
          exclude_patterns: metadata.exclude_patterns,
          include_hidden: metadata.include_hidden ?? true,
          backup_name: metadata.backup_name
        })
      });

      if (response.ok) {
        // Handle file download
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${metadata.backup_name}.zip`;
        a.click();
        window.URL.revokeObjectURL(url);

        this.addFileOperation('备份已成功创建并下载！');
        window.toastFrontendInfo('备份已成功创建并下载', '备份状态');
      } else {
        // Try to parse error response
        const errorText = await response.text();
        try {
          const errorJson = JSON.parse(errorText);
          this.error = errorJson.error || '备份创建失败';
        } catch {
          this.error = `备份创建失败: ${response.status} ${response.statusText}`;
        }
        this.addFileOperation(`Error: ${this.error}`);
      }

    } catch (error) {
      this.error = `备份错误: ${error.message}`;
      this.addFileOperation(`Error: ${error.message}`);
    } finally {
      this.loading = false;
    }
  },

  async downloadBackup(backupPath, backupName) {
    try {
      const response = await fetchApi('/backup_download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ backup_path: backupPath })
      });

      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${backupName}.zip`;
        a.click();
        window.URL.revokeObjectURL(url);
      }
    } catch (error) {
      console.error('Download error:', error);
    }
  },

  cancelBackup() {
    if (this.progressEventSource) {
      this.progressEventSource.close();
      this.progressEventSource = null;
    }
    this.loading = false;
    this.progressData = null;
  },

  resetToDefaults() {
    this.getDefaultBackupMetadata().then(defaultMetadata => {
      if (this.backupEditor) {
        this.backupEditor.setValue(JSON.stringify(defaultMetadata, null, 2));
        this.backupEditor.clearSelection();
      }
      this.updatePreview();
    });
  },

  // Dry run functionality
  async dryRun() {
    if (this.mode === 'backup') {
      await this.dryRunBackup();
    } else if (this.mode === 'restore') {
      await this.dryRunRestore();
    }
  },

  async dryRunBackup() {
    // Validate backup metadata first
    if (!this.validateBackupMetadata()) {
      return;
    }

    try {
      this.loading = true;
      this.loadingMessage = '正在执行试运行...';
      this.error = '';
      this.clearFileOperations();
      this.addFileOperation('开始备份试运行...');

      const metadata = this.backupMetadataConfig;
      const patternsString = this.convertPatternsToString(metadata.include_patterns, metadata.exclude_patterns);

      const response = await sendJsonData("backup_test", {
        patterns: patternsString,
        include_hidden: metadata.include_hidden ?? true,
        max_files: 10000
      });

      if (response.success) {
        this.addFileOperation(`找到 ${response.files.length} 个将被备份的文件:`);
        response.files.forEach((file, index) => {
          this.addFileOperation(`${index + 1}. ${file.path} (${this.formatFileSize(file.size)})`);
        });
        this.addFileOperation(`\n总计: ${response.files.length} 个文件, ${this.formatFileSize(response.files.reduce((sum, f) => sum + f.size, 0))}`);
        this.addFileOperation('试运行成功完成。');
      } else {
        this.error = response.error;
        this.addFileOperation(`Error: ${response.error}`);
      }
    } catch (error) {
      this.error = `试运行错误: ${error.message}`;
      this.addFileOperation(`Error: ${error.message}`);
    } finally {
      this.loading = false;
    }
  },

  async dryRunRestore() {
    if (!this.backupFile) {
      this.error = '请先选择备份文件';
      return;
    }

    try {
      this.loading = true;
      this.loadingMessage = '正在执行恢复试运行...';
      this.error = '';
      this.restoreResult = null;
      this.clearFileOperations();
      this.addFileOperation('开始恢复试运行...');

      const formData = new FormData();
      formData.append('backup_file', this.backupFile);
      formData.append('metadata', this.getEditorValue());
      formData.append('overwrite_policy', this.overwritePolicy);
      formData.append('clean_before_restore', this.cleanBeforeRestore);

      const response = await fetchApi('/backup_restore_preview', {
        method: 'POST',
        body: formData
      });

      const result = await response.json();

      if (result.success) {
        // Show delete operations if clean before restore is enabled
        if (result.files_to_delete && result.files_to_delete.length > 0) {
          this.addFileOperation(`恢复前清理 - ${result.files_to_delete.length} 个文件将被删除:`);
          result.files_to_delete.forEach((file, index) => {
            this.addFileOperation(`${index + 1}. DELETE: ${file.path}`);
          });
          this.addFileOperation('');
        }

        // Show restore operations
        if (result.files_to_restore && result.files_to_restore.length > 0) {
          this.addFileOperation(`${result.files_to_restore.length} 个文件将被恢复:`);
          result.files_to_restore.forEach((file, index) => {
            this.addFileOperation(`${index + 1}. RESTORE: ${file.original_path} -> ${file.target_path}`);
          });
        }

        // Show skipped files
        if (result.skipped_files && result.skipped_files.length > 0) {
          this.addFileOperation(`\nSkipped ${result.skipped_files.length} files:`);
          result.skipped_files.forEach((file, index) => {
            this.addFileOperation(`${index + 1}. ${file.original_path} (${file.reason})`);
          });
        }

        const deleteCount = result.delete_count || 0;
        const restoreCount = result.restore_count || 0;
        const skippedCount = result.skipped_files?.length || 0;

        this.addFileOperation(`\n摘要: ${deleteCount} 个待删除, ${restoreCount} 个待恢复, ${skippedCount} 个已跳过`);
        this.addFileOperation('试运行成功完成。');
      } else {
        this.error = result.error;
        this.addFileOperation(`Error: ${result.error}`);
      }
    } catch (error) {
      this.error = `试运行错误: ${error.message}`;
      this.addFileOperation(`Error: ${error.message}`);
    } finally {
      this.loading = false;
    }
  },

  // Enhanced Restore Operations with Metadata Display
  async handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    this.backupFile = file;
    this.error = '';
    this.restoreResult = null;

    try {
      this.loading = true;
      this.loadingMessage = '正在检查备份档案...';

      const formData = new FormData();
      formData.append('backup_file', file);

      const response = await fetchApi('/backup_inspect', {
        method: 'POST',
        body: formData
      });

      const result = await response.json();

      if (result.success) {
        this.backupMetadata = result.metadata;

        // Load complete metadata for JSON editing
        this.restoreMetadata = JSON.parse(JSON.stringify(result.metadata)); // Deep copy

        // Initialize restore editor with complete metadata JSON
        if (this.restoreEditor) {
          this.restoreEditor.setValue(JSON.stringify(this.restoreMetadata, null, 2));
          this.restoreEditor.clearSelection();
        }

        // Validate backup compatibility
        this.validateBackupCompatibility();
      } else {
        this.error = result.error;
        this.backupMetadata = null;
      }
    } catch (error) {
      this.error = `检查错误: ${error.message}`;
      this.backupMetadata = null;
    } finally {
      this.loading = false;
    }
  },

  validateBackupCompatibility() {
    if (!this.backupMetadata) return;

    const warnings = [];

    // Check Agent Zero version compatibility
    // Note: Both backup and current versions are obtained via git.get_git_info()
    const backupVersion = this.backupMetadata.agent_zero_version;
    const currentVersion = globalThis.gitinfo.version; // Retrieved from git.get_git_info() on backend

    if (backupVersion !== currentVersion && backupVersion !== "development") {
      warnings.push(`备份创建时的 Agent Zero 版本为 ${backupVersion}，当前版本为 ${currentVersion}`);
    }

    // Check backup age
    const backupDate = new Date(this.backupMetadata.timestamp);
    const daysSinceBackup = (Date.now() - backupDate) / (1000 * 60 * 60 * 24);

    if (daysSinceBackup > 30) {
      warnings.push(`备份已有 ${Math.floor(daysSinceBackup)} 天`);
    }

    // Check system compatibility
    const systemInfo = this.backupMetadata.system_info;
    if (systemInfo && systemInfo.system) {
      // Could add platform-specific warnings here
    }

    if (warnings.length > 0) {
      window.toastFrontendWarning(`兼容性警告: ${warnings.join(', ')}`, '备份兼容性');
    }
  },

  async performRestore() {
    if (!this.backupFile) {
      this.error = '请选择备份文件';
      return;
    }

    try {
      this.loading = true;
      this.loadingMessage = '正在恢复文件...';
      this.error = '';
      this.restoreResult = null;
      this.clearFileOperations();
      this.addFileOperation('开始文件恢复...');

      const formData = new FormData();
      formData.append('backup_file', this.backupFile);
      formData.append('metadata', this.getEditorValue());
      formData.append('overwrite_policy', this.overwritePolicy);
      formData.append('clean_before_restore', this.cleanBeforeRestore);

      const response = await fetchApi('/backup_restore', {
        method: 'POST',
        body: formData
      });

      const result = await response.json();

      if (result.success) {
        // Log deleted files if clean before restore was enabled
        if (result.deleted_files && result.deleted_files.length > 0) {
          this.addFileOperation(`恢复前清理 - 已成功删除 ${result.deleted_files.length} 个文件:`);
          result.deleted_files.forEach((file, index) => {
            this.addFileOperation(`${index + 1}. DELETED: ${file.path}`);
          });
          this.addFileOperation('');
        }

        // Log restored files
        this.addFileOperation(`已成功恢复 ${result.restored_files.length} 个文件:`);
        result.restored_files.forEach((file, index) => {
          this.addFileOperation(`${index + 1}. RESTORED: ${file.archive_path} -> ${file.target_path}`);
        });

        // Log skipped files
        if (result.skipped_files && result.skipped_files.length > 0) {
          this.addFileOperation(`\n跳过 ${result.skipped_files.length} 个文件:`);
          result.skipped_files.forEach((file, index) => {
            this.addFileOperation(`${index + 1}. ${file.original_path} (${file.reason})`);
          });
        }

        // Log errors
        if (result.errors && result.errors.length > 0) {
          this.addFileOperation(`\n恢复过程中的错误:`);
          result.errors.forEach((error, index) => {
            this.addFileOperation(`${index + 1}. ${error.original_path}: ${error.error}`);
          });
        }

        const deletedCount = result.deleted_files?.length || 0;
        const restoredCount = result.restored_files.length;
        const skippedCount = result.skipped_files?.length || 0;
        const errorCount = result.errors?.length || 0;

        this.addFileOperation(`\n恢复完成: ${deletedCount} 个已删除, ${restoredCount} 个已恢复, ${skippedCount} 个已跳过, ${errorCount} 个错误`);
        this.restoreResult = result;
        window.toastFrontendInfo('恢复已成功完成', '恢复状态');
      } else {
        this.error = result.error;
        this.addFileOperation(`Error: ${result.error}`);
      }
    } catch (error) {
      this.error = `恢复错误: ${error.message}`;
      this.addFileOperation(`Error: ${error.message}`);
    } finally {
      this.loading = false;
    }
  },

  // JSON Metadata Utilities
  validateRestoreMetadata() {
    try {
      const metadataText = this.getEditorValue();
      const metadata = JSON.parse(metadataText);

      // Validate required fields
      if (!Array.isArray(metadata.include_patterns)) {
        throw new Error('include_patterns must be an array');
      }
      if (!Array.isArray(metadata.exclude_patterns)) {
        throw new Error('exclude_patterns must be an array');
      }

      this.restoreMetadata = metadata;
      this.error = '';
      return true;
    } catch (error) {
      this.error = `无效的 JSON 元数据: ${error.message}`;
      return false;
    }
  },

  getCurrentRestoreMetadata() {
    if (this.validateRestoreMetadata()) {
      return this.restoreMetadata;
    }
    return null;
  },

  // Restore Operations - Metadata Control
  resetToOriginalMetadata() {
    if (this.backupMetadata) {
      this.restoreMetadata = JSON.parse(JSON.stringify(this.backupMetadata)); // Deep copy

      if (this.restoreEditor) {
        this.restoreEditor.setValue(JSON.stringify(this.restoreMetadata, null, 2));
        this.restoreEditor.clearSelection();
      }
    }
  },

  // Utility
  formatTimestamp(timestamp) {
    if (!timestamp) return 'Unknown';
    return new Date(timestamp).toLocaleString();
  },

  formatFileSize(bytes) {
    if (!bytes) return '0 B';
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`;
  },

  formatDate(dateString) {
    if (!dateString) return 'Unknown';
    return new Date(dateString).toLocaleDateString();
  }
};

const store = createStore("backupStore", model);
export { store };
