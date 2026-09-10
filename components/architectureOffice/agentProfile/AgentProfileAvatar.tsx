import React from 'react';
import { Sparkles } from 'lucide-react';
import { PersonaAvatar } from '../PersonaAvatar';
import { cn } from '../../ui';
import type { OfficeAgentProfile } from '../../../services/architectureOffice';

export interface AgentProfileAvatarProps {
  profile: OfficeAgentProfile;
  size?: 'md' | 'lg';
  className?: string;
}

/** Shared visual identity for profiles, including customization and availability. */
export const AgentProfileAvatar: React.FC<AgentProfileAvatarProps> = ({ profile, size = 'md', className }) => (
  <span className={cn('relative inline-flex shrink-0', className)} aria-hidden>
    <span className="absolute -inset-1 rounded-[1.15rem] bg-gradient-to-br from-primary-500/25 via-transparent to-ai-500/30 blur-sm" />
    {profile.avatar ? (
      <span className={cn(
        'relative inline-flex items-center justify-center rounded-2xl border border-white/70 bg-gradient-to-br from-white to-primary-50 shadow-soft dark:border-white/10 dark:from-gray-800 dark:to-primary-950',
        size === 'lg' ? 'h-16 w-16 text-3xl' : 'h-12 w-12 text-2xl',
      )}>
        {profile.avatar}
      </span>
    ) : (
      <PersonaAvatar
        personaId={profile.agentId}
        size="md"
        decorative
        className={cn('relative shadow-soft', size === 'lg' && 'h-16 w-16 rounded-2xl [&>svg]:h-7 [&>svg]:w-7')}
      />
    )}
    <span className={cn(
      'absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-[3px] border-white dark:border-gray-900',
      profile.enabled ? 'bg-emerald-500' : 'bg-gray-400',
    )} />
    {profile.customized && (
      <span className="absolute -right-2 -top-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-ai-500 text-white shadow-soft">
        <Sparkles className="h-3 w-3" />
      </span>
    )}
  </span>
);

export default AgentProfileAvatar;
