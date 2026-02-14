

# Add Email/Password Authentication

## Overview

Create a login/signup page so you can authenticate and test all the RLS-protected database features (Income Calculator, etc.). The existing `profiles` table and `user_roles` table with `has_role()` function are already in place, along with a trigger to auto-create profiles on signup.

## What Gets Built

### 1. Auth Page (`src/pages/Auth.tsx`)
- Single page with toggle between Login and Sign Up tabs
- **Sign Up**: name, email, password fields. On submit calls `supabase.auth.signUp()` with `emailRedirectTo: window.location.origin`
- **Login**: email, password fields. On submit calls `supabase.auth.signInWithPassword()`
- Shows toast messages for errors and success (e.g., "Check your email to confirm")
- Redirects to `/` (Dashboard) on successful login

### 2. Auth Context (`src/contexts/AuthContext.tsx`)
- Provides `user`, `session`, `loading`, `signOut` via React context
- Sets up `onAuthStateChange` listener before calling `getSession()` (per best practices)
- Wraps the entire app in `App.tsx`

### 3. Protected Routes
- Create a `ProtectedRoute` component that checks for active session
- If no session, redirect to `/auth`
- Wrap all existing routes inside `AppLayout` with this guard

### 4. Update `AppHeader.tsx`
- Replace hardcoded "Alex Morgan" with the authenticated user's name from the profiles table
- Wire up the "Log out" button to call `signOut()`

### 5. Routing Changes (`App.tsx`)
- Add `/auth` route (outside `AppLayout`, no sidebar)
- Wrap `AppLayout` routes with `ProtectedRoute`

## Files Summary

| Action | File |
|---|---|
| Create | `src/pages/Auth.tsx` |
| Create | `src/contexts/AuthContext.tsx` |
| Create | `src/components/ProtectedRoute.tsx` |
| Modify | `src/App.tsx` -- add auth route and protected wrapper |
| Modify | `src/components/layout/AppHeader.tsx` -- use real user data, wire logout |

## Technical Notes

- No database migration needed -- `profiles` table, `user_roles` table, `has_role()` function, and the auto-create-profile trigger already exist
- Email confirmation is enabled by default (not auto-confirm) -- user will need to verify email before signing in
- The `profiles` table insert RLS requires `auth.uid() = user_id`, which the existing trigger handles
- After signup and email confirmation, the user can log in and all RLS-protected queries will work with their session

