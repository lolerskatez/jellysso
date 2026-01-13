# How JellySSO Works - Simple Explanation

A complete guide explaining how JellySSO enables Single Sign-On for Jellyfin.

---

## Overview

Imagine JellySSO as a **bridge that lets you use a single login for Jellyfin** instead of remembering a separate password.

---

## 1. Installation Phase 🔧

**What you install:**
- **Jellyfin Companion App** - A separate web application that acts as the "middle man"
- **Jellyfin SSO Plugin** - A small add-on that goes into Jellyfin itself

**Why two pieces?**
- Jellyfin (the media server) only handles media
- The Companion App is a separate service that specializes in logins
- They talk to each other behind the scenes

---

## 2. Configuration Phase ⚙️

You tell both pieces:
- **"Where's our identity provider?"** - Point to your login service (Google, Azure AD, Authentik, Keycloak, etc.)
- **"How do they recognize each other?"** - Exchange secret API keys so they know it's really each other talking

Think of it like:
- You give Jellyfin a phone number to call the Companion App
- You give the Companion App a password to prove it's allowed to talk to Jellyfin
- Both services verify each other with this secret code

---

## 3. Login Flow 🔐

**What actually happens when a user logs in:**

```
User → "I want to watch movies"
        ↓
    Jellyfin → "You need to log in"
        ↓
    Redirects to Companion App → "Who are you?"
        ↓
    Companion App → "Let me check with our identity provider"
        ↓
    Google/Azure/Authentik → "Please log in"
        ↓
    User → "Here's my email and password"
        ↓
    Identity Provider → ✅ "That's correct! Here's a ticket"
        ↓
    Companion App → "Great! Let me tell Jellyfin about this"
        ↓
    Jellyfin → ✅ "Welcome! Session created"
        ↓
    User → Enjoys their movies
```

---

## 4. Key Benefits 💡

| Problem | Solution |
|---------|----------|
| Users have to remember Jellyfin password | They use their work/school account instead |
| Jellyfin doesn't know about company accounts | Identity provider tells it who the user is |
| Users can't log out everywhere at once | Identity provider handles all logouts |
| Creating users is manual | Can auto-create them from identity provider |

---

## 5. What Happens Behind the Scenes 🔍

- **Session Validation** - Every so often, the Companion App checks: "Is this user still allowed access?"
- **Audit Logs** - Records who logged in and when (for security)
- **Auto-User Creation** - When someone logs in for the first time, Jellyfin automatically creates an account for them
- **Permission Sync** - Can automatically make users admins if they're in a special group in your identity provider

---

## The Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    YOUR IDENTITY PROVIDER                        │
│         (Google, Azure AD, Authentik, Keycloak, etc.)           │
└─────────────────────────────────────────────────────────────────┘
                              ▲
                              │
                    ┌─────────┴──────────┐
                    │                    │
        ┌───────────▼─────────┐   ┌──────▼──────────────┐
        │   JELLYFIN COMPANION│   │ JELLYFIN + SSO      │
        │      APP (Node.js)  │   │ PLUGIN (.NET/C#)    │
        │                     │   │                      │
        │ - Handles OAuth flow│   │ - Installed in      │
        │ - Manages sessions  │───│   Jellyfin server   │
        │ - Issues tokens     │   │ - Validates tokens  │
        │                     │   │ - Auto-creates users│
        └─────────────────────┘   └──────────────────────┘
```

---

## What Each Component Does

### **JellySSO (Companion App)** 🌐
- **What it is:** A separate web application written in Node.js
- **Where it runs:** On its own server (not in Jellyfin)
- **What it does:**
  - Talks to your identity provider (Google, Azure AD, etc.)
  - Handles the login process
  - **Creates tokens** (special digital tickets proving who you are)
  - Manages user sessions

### **SSO Plugin (In Jellyfin)** 🔌
- **What it is:** A plugin you install inside Jellyfin
- **Where it runs:** Directly in your Jellyfin server
- **What it does:**
  - **Validates tokens** sent by the Companion App
  - **Creates users** in Jellyfin automatically
  - **Updates user permissions** (promotions to admin, etc.)
  - **Logs SSO attempts** for audit trails

---

## What Happens When They Connect

**Step-by-step:**

1. **User logs in** → Companion App gets their credentials from identity provider
2. **Companion App creates a token** → "This is definitely Bob from our company"
3. **User visits Jellyfin** → They send the token from the Companion App
4. **Jellyfin's SSO Plugin receives it** → "Wait, is this real? Let me ask the Companion App"
5. **Plugin calls back to Companion App** → "Hey, is this token real?"
6. **Companion App verifies** → "Yes! That token is valid for Bob"
7. **Plugin creates/updates user** → Bob's account gets created or updated in Jellyfin
8. **User is logged in** → Bob can watch movies

---

## The Connection Details

When the plugin connects to the Companion App, it:

| Action | Why |
|--------|-----|
| **Validates tokens** | Makes sure the user is really who they say they are |
| **Tests the connection** | Checks if Companion App is still running and reachable |
| **Auto-creates users** | Takes the username/email from the token and creates a Jellyfin account |
| **Sets admin privileges** | If the identity provider says they're an admin, Jellyfin makes them an admin |
| **Logs everything** | Records who logged in, when, and whether it succeeded |

---

## In Simple Terms

> **Companion App = The Bouncer at the Door**  
> **SSO Plugin = The Gatekeeper Inside**

- The **Bouncer (Companion App)** checks your ID at the front door and gives you a ticket
- The **Gatekeeper (SSO Plugin)** sees your ticket and lets you in (or asks the Bouncer if it's real)

They talk to each other using:
- **Shared Secret** - A password only they know
- **Tokens** - Digital proof of identity
- **API calls** - Messages they send back and forth over the network

---

## In One Sentence 📝

> **JellySSO lets Jellyfin borrow your company's login system instead of managing its own logins.**

It's like how you can sign into apps using "Sign in with Google" instead of creating a new account!

---

## Security Notes 🔒

- All communication between components uses HTTPS (encrypted)
- Tokens expire after a set time (configurable)
- Shared secrets are never transmitted, only used for verification
- Audit logs track all authentication attempts
- Failed login attempts are logged for security monitoring
