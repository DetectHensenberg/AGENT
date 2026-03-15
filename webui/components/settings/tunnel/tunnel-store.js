import { createStore } from "/js/AlpineStore.js";
import * as Sleep from "/js/sleep.js";

// define the model object holding data and functions
const model = {
  isLoading: false,
  tunnelLink: "",
  linkGenerated: false,
  loadingText: "",
  qrCodeInstance: null,
  provider: "cloudflared",
  microsoftLoginCode: "",
  microsoftLoginUrl: "",
  codeCopied: false,
  notificationPollInterval: null,
  hasError: false,

  init() {
    this.checkTunnelStatus();
  },

  clearMicrosoftLogin() {
    this.microsoftLoginCode = "";
    this.microsoftLoginUrl = "";
    this.codeCopied = false;
  },

  copyLoginCode() {
    if (!this.microsoftLoginCode) return;
    navigator.clipboard.writeText(this.microsoftLoginCode).then(() => {
      this.codeCopied = true;
      window.toastFrontendInfo("登录代码已复制到剪贴板！", "剪贴板");
      // Reset after 3 seconds
      setTimeout(() => {
        this.codeCopied = false;
      }, 3000);
    }).catch((err) => {
      console.error("Failed to copy code: ", err);
      window.toastFrontendError("复制登录代码失败", "剪贴板错误");
    });
  },

  processNotifications(notifications) {
    if (!notifications || !Array.isArray(notifications)) return;
    
    for (const n of notifications) {
      switch (n.event) {
        case "downloading":
          this.loadingText = n.message;
          break;
        case "download_progress":
          if (n.data && n.data.percent !== undefined) {
            this.loadingText = `正在下载: ${n.data.percent.toFixed(1)}%`;
          } else {
            this.loadingText = n.message;
          }
          break;
        case "download_complete":
          this.loadingText = n.message;
          break;
        case "creating_tunnel":
          this.clearMicrosoftLogin();
          this.loadingText = n.message;
          break;
        case "info":
          // Check for Microsoft login code
          if (n.data && n.data.code) {
            this.microsoftLoginCode = n.data.code;
            this.microsoftLoginUrl = n.data.url || "";
            this.loadingText = "等待 Microsoft 登录...";
          } else {
            this.loadingText = n.message;
          }
          break;
        case "error":
          this.hasError = true;
          window.toastFrontendError(n.message, "隧道错误");
          this.stopNotificationPolling();
          break;
        case "tunnel_url":
          if (n.data && n.data.url) {
            this.tunnelLink = n.data.url;
            this.linkGenerated = true;
          }
          break;
        case "tunnel_stopped":
          this.loadingText = n.message;
          break;
      }
    }
  },

  startNotificationPolling() {
    this.stopNotificationPolling();
    this.hasError = false;
    this.notificationPollInterval = setInterval(async () => {
      try {
        const response = await fetchApi("/tunnel_proxy", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "notifications" }),
        });
        const data = await response.json();
        if (data.notifications) {
          this.processNotifications(data.notifications);
        }
        // Check if tunnel is ready
        if (data.tunnel_url && data.is_running) {
          this.tunnelLink = data.tunnel_url;
          this.linkGenerated = true;
          this.stopNotificationPolling();
        }
      } catch (error) {
        console.error("Error polling notifications:", error);
      }
    }, 500);
  },

  stopNotificationPolling() {
    if (this.notificationPollInterval) {
      clearInterval(this.notificationPollInterval);
      this.notificationPollInterval = null;
    }
  },

  generateQRCode() {
    if (!this.tunnelLink) return;

    const qrContainer = document.getElementById("qrcode-tunnel");
    if (!qrContainer) return;

    // Clear any existing QR code
    qrContainer.innerHTML = "";

    try {
      // Generate new QR code
      this.qrCodeInstance = new QRCode(qrContainer, {
        text: this.tunnelLink,
        width: 128,
        height: 128,
        colorDark: "#000000",
        colorLight: "#ffffff",
        correctLevel: QRCode.CorrectLevel.M,
      });
    } catch (error) {
      console.error("Error generating QR code:", error);
      qrContainer.innerHTML =
        '<div class="qr-error">QR 码生成失败</div>';
    }
  },

  async checkTunnelStatus() {
    try {
      const response = await fetchApi("/tunnel_proxy", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "get" }),
      });

      const data = await response.json();

      if (data.success && data.tunnel_url) {
        // Update the stored URL if it's different from what we have
        if (this.tunnelLink !== data.tunnel_url) {
          this.tunnelLink = data.tunnel_url;
          localStorage.setItem("agent_zero_tunnel_url", data.tunnel_url);
        }
        this.linkGenerated = true;
        // Generate QR code for the tunnel URL
        Sleep.Skip().then(() => this.generateQRCode());
      } else {
        // Check if we have a stored tunnel URL
        const storedTunnelUrl = localStorage.getItem("agent_zero_tunnel_url");

        if (storedTunnelUrl) {
          // Use the stored URL but verify it's still valid
          const verifyResponse = await fetchApi("/tunnel_proxy", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ action: "verify", url: storedTunnelUrl }),
          });

          const verifyData = await verifyResponse.json();

          if (verifyData.success && verifyData.is_valid) {
            this.tunnelLink = storedTunnelUrl;
            this.linkGenerated = true;
            // Generate QR code for the tunnel URL
            Sleep.Skip().then(() => this.generateQRCode());
          } else {
            // Clear stale URL
            localStorage.removeItem("agent_zero_tunnel_url");
            this.tunnelLink = "";
            this.linkGenerated = false;
          }
        } else {
          // No stored URL, show the generate button
          this.tunnelLink = "";
          this.linkGenerated = false;
        }
      }
    } catch (error) {
      console.error("Error checking tunnel status:", error);
      this.tunnelLink = "";
      this.linkGenerated = false;
    }
  },

  async refreshLink() {
    // Call generate but with a confirmation first
    if (
      confirm(
        "您确定要生成新的隧道 URL 吗？旧的 URL 将不再有效。"
      )
    ) {

      this.isLoading = true;
      this.hasError = false;
      this.clearMicrosoftLogin();
      this.loadingText = "正在刷新隧道...";

      // Change refresh button appearance
      const refreshButton = document.querySelector("#tunnel-settings-section .refresh-link-button");
      const originalContent = refreshButton.innerHTML;
      refreshButton.innerHTML =
        '<span class="icon material-symbols-outlined spin">progress_activity</span> 正在刷新...';
      refreshButton.disabled = true;
      refreshButton.classList.add("refreshing");

      try {
        // First stop any existing tunnel
        const stopResponse = await fetchApi("/tunnel_proxy", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ action: "stop" }),
        });

        // Check if stopping was successful
        const stopData = await stopResponse.json();
        if (!stopData.success) {
          console.warn("Warning: Couldn't stop existing tunnel cleanly");
          // Continue anyway since we want to create a new one
        }

        // Then generate a new one
        await this.generateLink();
      } catch (error) {
        console.error("Error refreshing tunnel:", error);
        window.toastFrontendError("刷新隧道失败", "隧道错误");
        this.isLoading = false;
        this.loadingText = "";
      } finally {
        // Reset refresh button
        refreshButton.innerHTML = originalContent;
        refreshButton.disabled = false;
        refreshButton.classList.remove("refreshing");
      }
    }
  },

  async generateLink() {
    // First check if authentication is enabled
    try {
      const authCheckResponse = await fetchApi("/settings_get");
      const authData = await authCheckResponse.json();

      // Find the auth_login and auth_password in the settings
      let hasAuth = false;

      if (authData && authData.settings) {
        const { auth_login, auth_password } = authData.settings;
        hasAuth = Boolean(auth_login && auth_password);
      }

      // If no authentication is set, warn the user
      if (!hasAuth) {
        const proceed = confirm(
          "警告：您的 Agent Zero 实例未配置身份验证。\n\n" +
            "在没有身份验证的情况下创建公共隧道意味着任何拥有 URL 的人" +
            "都可以访问您的 Agent Zero 实例。\n\n" +
            "建议在创建公共隧道之前，在 设置 > 身份验证 中设置身份验证。\n\n" +
            "是否仍要继续？"
        );

        if (!proceed) {
          return; // User cancelled
        }
      }
    } catch (error) {
      console.error("Error checking authentication status:", error);
      // Continue anyway if we can't check auth status
    }

    this.isLoading = true;
    this.hasError = false;
    this.clearMicrosoftLogin();
    this.loadingText = "正在启动隧道...";

    // Change create button appearance
    const createButton = document.querySelector("#tunnel-settings-section .tunnel-actions .btn-ok");
    if (createButton) {
      createButton.innerHTML =
        '<span class="icon material-symbols-outlined spin">progress_activity</span> 正在创建...';
      createButton.disabled = true;
      createButton.classList.add("creating");
    }

    // Start polling for notifications
    this.startNotificationPolling();

    try {
      // Call the backend API to create a tunnel
      const response = await fetchApi("/tunnel_proxy", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "create",
          provider: this.provider,
        }),
      });

      const data = await response.json();

      // Process any notifications from response
      if (data.notifications) {
        this.processNotifications(data.notifications);
      }

      // Check for error
      if (!data.success && data.message) {
        this.hasError = true;
        window.toastFrontendError(data.message, "隧道错误");
        console.error("Tunnel creation failed:", data);
        this.stopNotificationPolling();
        return;
      }

      if (data.success && data.tunnel_url) {
        // Store the tunnel URL in localStorage for persistence
        localStorage.setItem("agent_zero_tunnel_url", data.tunnel_url);

        this.tunnelLink = data.tunnel_url;
        this.linkGenerated = true;
        this.stopNotificationPolling();

        // Generate QR code for the tunnel URL
        Sleep.Skip().then(() => this.generateQRCode());

        // Show success message to confirm creation
        window.toastFrontendInfo(
          "隧道创建成功",
          "隧道状态"
        );
      }
    } catch (error) {
      window.toastFrontendError("创建隧道失败", "隧道错误");
      console.error("Error creating tunnel:", error);
    } finally {
      this.isLoading = false;
      this.loadingText = "";
      this.stopNotificationPolling();
      this.clearMicrosoftLogin();

      // Reset create button if it's still in the DOM
      const createButton = document.querySelector("#tunnel-settings-section .tunnel-actions .btn-ok");
      if (createButton) {
        createButton.innerHTML =
          '<span class="icon material-symbols-outlined">play_circle</span> 创建隧道';
        createButton.disabled = false;
        createButton.classList.remove("creating");
      }
    }
  },

  async stopTunnel() {
    if (
      confirm(
        "您确定要停止隧道吗？URL 将不再可访问。"
      )
    ) {
      this.isLoading = true;
      this.loadingText = "正在停止隧道...";

      try {
        // Call the backend to stop the tunnel
        const response = await fetchApi("/tunnel_proxy", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ action: "stop" }),
        });

        const data = await response.json();

        if (data.success) {
          // Clear the stored URL
          localStorage.removeItem("agent_zero_tunnel_url");

          // Clear QR code
          const qrContainer = document.getElementById("qrcode-tunnel");
          if (qrContainer) {
            qrContainer.innerHTML = "";
          }
          this.qrCodeInstance = null;

          // Update UI state
          this.tunnelLink = "";
          this.linkGenerated = false;

          window.toastFrontendInfo(
            "隧道已成功停止",
            "隧道状态"
          );
        } else {
          window.toastFrontendError("停止隧道失败", "隧道错误");

          // Reset stop button
          stopButton.innerHTML = originalStopContent;
          stopButton.disabled = false;
          stopButton.classList.remove("stopping");
        }
      } catch (error) {
        window.toastFrontendError("停止隧道失败", "隧道错误");
        console.error("Error stopping tunnel:", error);

        // Reset stop button
        stopButton.innerHTML = originalStopContent;
        stopButton.disabled = false;
        stopButton.classList.remove("stopping");
      } finally {
        this.isLoading = false;
        this.loadingText = "";
      }
    }
  },

  copyToClipboard() {
    if (!this.tunnelLink) return;

    const copyButton = document.querySelector("#tunnel-settings-section .copy-link-button");
    const originalContent = copyButton.innerHTML;

    navigator.clipboard
      .writeText(this.tunnelLink)
      .then(() => {
        // Update button to show success state
        copyButton.innerHTML =
          '<span class="icon material-symbols-outlined">check</span> 已复制!';
        copyButton.classList.add("copy-success");

        // Show toast notification
        window.toastFrontendInfo(
          "隧道 URL 已复制到剪贴板！",
          "剪贴板"
        );

        // Reset button after 2 seconds
        setTimeout(() => {
          copyButton.innerHTML = originalContent;
          copyButton.classList.remove("copy-success");
        }, 2000);
      })
      .catch((err) => {
        console.error("Failed to copy URL: ", err);
        window.toastFrontendError(
          "复制隧道 URL 失败",
          "剪贴板错误"
        );

        // Show error state
        copyButton.innerHTML =
          '<span class="icon material-symbols-outlined">close</span> 失败';
        copyButton.classList.add("copy-error");

        // Reset button after 2 seconds
        setTimeout(() => {
          copyButton.innerHTML = originalContent;
          copyButton.classList.remove("copy-error");
        }, 2000);
      });
  },
};

// convert it to alpine store
const store = createStore("tunnelStore", model);

// export for use in other files
export { store };
