import React, { useState } from 'react';
import { signOut } from 'firebase/auth';
import { LogOut, Moon, Sun } from 'lucide-react';
import { auth } from '../firebase';
import type { ThemeMode, UserProfile } from '../types';
import { updateUserSettings } from '../services/studyDb';

interface SettingsViewProps {
  uid: string;
  profile: UserProfile | null;
  theme: ThemeMode;
  onChangeTheme: (theme: ThemeMode) => void;
}

export function SettingsView({ uid, profile, theme, onChangeTheme }: SettingsViewProps) {
  const [displayName, setDisplayName] = useState(profile?.displayName || '');
  const [dailyGoalMinutes, setDailyGoalMinutes] = useState(profile?.dailyGoalMinutes || 90);
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSavedNotice(false);
    try {
      await updateUserSettings(uid, {
        displayName,
        dailyGoalMinutes,
        theme,
      });
      setSavedNotice(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
          Profile & Preferences
        </h1>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
          Customize your academic goals, display name, and workspace appearance
        </p>
      </div>

      <form
        onSubmit={handleSave}
        className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-6 space-y-5"
      >
        <div className="flex items-center gap-4 pb-4 border-b border-slate-100 dark:border-slate-800">
          {profile?.photoURL ? (
            <img
              src={profile.photoURL}
              alt={profile.displayName}
              referrerPolicy="no-referrer"
              className="w-12 h-12 rounded-full object-cover border border-slate-200 dark:border-slate-700"
            />
          ) : (
            <div className="w-12 h-12 rounded-full bg-indigo-600 text-white flex items-center justify-center font-display font-bold">
              {(profile?.displayName || 'S').slice(0, 1).toUpperCase()}
            </div>
          )}
          <div>
            <p className="text-sm font-semibold text-slate-900 dark:text-white">{profile?.displayName}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">{profile?.email}</p>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
            Display Name
          </label>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="w-full px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-white"
            required
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
            Daily Study Goal ({dailyGoalMinutes} minutes)
          </label>
          <input
            type="range"
            min={15}
            max={360}
            step={15}
            value={dailyGoalMinutes}
            onChange={(e) => setDailyGoalMinutes(Number(e.target.value))}
            className="w-full accent-indigo-600"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-2">
            Appearance
          </label>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => onChangeTheme('light')}
              className={`flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl border text-sm font-medium transition-colors ${
                theme === 'light'
                  ? 'border-indigo-600 bg-indigo-50 dark:bg-indigo-950/50 text-indigo-900 dark:text-indigo-200'
                  : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
            >
              <Sun className="w-4 h-4" />
              Light Mode
            </button>
            <button
              type="button"
              onClick={() => onChangeTheme('dark')}
              className={`flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl border text-sm font-medium transition-colors ${
                theme === 'dark'
                  ? 'border-indigo-600 bg-indigo-950/50 text-indigo-200'
                  : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
              }`}
            >
              <Moon className="w-4 h-4" />
              Dark Mode
            </button>
          </div>
        </div>

        {savedNotice && (
          <p className="text-xs text-emerald-600 dark:text-emerald-400">Preferences saved.</p>
        )}

        <div className="flex items-center justify-between pt-4 border-t border-slate-100 dark:border-slate-800">
          <button
            type="button"
            onClick={() => signOut(auth)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30"
          >
            <LogOut className="w-4 h-4" />
            Sign Out
          </button>
          <button
            type="submit"
            disabled={saving}
            className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium"
          >
            {saving ? 'Saving...' : 'Save Preferences'}
          </button>
        </div>
      </form>
    </div>
  );
}
