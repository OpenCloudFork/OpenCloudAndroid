import { registerPlugin } from "@capacitor/core";

interface AuthWebViewPlugin {
  open(options: { url: string; redirectPattern?: string }): Promise<{ url: string }>;
}

const AuthWebView = registerPlugin<AuthWebViewPlugin>("AuthWebView");

export default AuthWebView;
