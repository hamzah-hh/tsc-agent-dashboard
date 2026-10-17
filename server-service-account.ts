// The private key that AI Studio embedded here was removed so it never enters git history.
// Credentials now come from FIREBASE_SERVICE_ACCOUNT (JSON or base64 JSON) or a local, git-ignored
// service-account.json (see server-firebase-admin.ts). project_id and client_email stay as metadata.
export const fallbackServiceAccount = {
  type: "service_account",
  project_id: "tsc-data-506812",
  private_key_id: "",
  private_key: "",
  client_email: "firebase-adminsdk-fbsvc@tsc-data-506812.iam.gserviceaccount.com",
  client_id: "",
  auth_uri: "https://accounts.google.com/o/oauth2/auth",
  token_uri: "https://oauth2.googleapis.com/token",
  auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
  client_x509_cert_url: "https://www.googleapis.com/robot/v1/metadata/x509/firebase-adminsdk-fbsvc%40tsc-data-506812.iam.gserviceaccount.com",
  universe_domain: "googleapis.com"
};
