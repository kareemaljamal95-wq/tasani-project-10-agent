'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Settings, User, Bell, Shield, Globe, Palette, Key, Bot } from 'lucide-react';

const sections = [
  { id: 'profile', icon: User, label: 'Profile' },
  { id: 'preferences', icon: Palette, label: 'Preferences' },
  { id: 'notifications', icon: Bell, label: 'Notifications' },
  { id: 'ai-config', icon: Bot, label: 'AI Configuration' },
  { id: 'api-keys', icon: Key, label: 'API Keys' },
  { id: 'security', icon: Shield, label: 'Security' },
];

export default function SettingsPage() {
  const [activeSection, setActiveSection] = useState('profile');

  return (
    <div className="space-y-8 animate-in">
      <div>
        <h1 className="text-3xl font-bold text-white">Settings</h1>
        <p className="text-white/60 mt-1">Manage your account and preferences</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <div className="space-y-1">
          {sections.map((sec) => {
            const Icon = sec.icon;
            return (
              <button
                key={sec.id}
                onClick={() => setActiveSection(sec.id)}
                className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm transition-all ${
                  activeSection === sec.id
                    ? 'bg-violet-500/20 text-violet-300 border border-violet-500/30'
                    : 'text-white/60 hover:text-white hover:bg-white/5'
                }`}
              >
                <Icon className="h-4 w-4" />
                {sec.label}
              </button>
            );
          })}
        </div>

        <div className="lg:col-span-3">
          <Card>
            <CardHeader>
              <CardTitle>Profile Settings</CardTitle>
              <CardDescription>Update your personal information</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <Input id="firstName" label="First Name" defaultValue="Ahmed" />
                <Input id="lastName" label="Last Name" defaultValue="Al-sayed" />
              </div>
              <Input id="email" type="email" label="Email" defaultValue="ahmed@karmish.ai" />
              <Input id="timezone" label="Timezone" defaultValue="Asia/Riyadh (UTC+3)" />
              <div className="pt-4">
                <Button>Save Changes</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
