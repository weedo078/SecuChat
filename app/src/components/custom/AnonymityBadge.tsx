import { useTranslation } from 'react-i18next';
import { Shield, AlertTriangle, Wifi } from 'lucide-react';

interface AnonymityBadgeProps {
  level: 'green' | 'yellow' | 'red';
  size?: 'sm' | 'md';
  showText?: boolean;
}

export function AnonymityBadge({ level, size = 'sm', showText = false }: AnonymityBadgeProps) {
  const { t } = useTranslation();

  const config = {
    green: {
      icon: Shield,
      color: 'text-teal-400',
      bgColor: 'bg-teal-400/10',
      borderColor: 'border-teal-400/30',
      text: t('anonymity.anonymous'),
      description: t('anonymity.anonymousDesc'),
    },
    yellow: {
      icon: Wifi,
      color: 'text-yellow-500',
      bgColor: 'bg-yellow-500/10',
      borderColor: 'border-yellow-500/30',
      text: t('anonymity.lan'),
      description: t('anonymity.lanDesc'),
    },
    red: {
      icon: AlertTriangle,
      color: 'text-red-500',
      bgColor: 'bg-red-500/10',
      borderColor: 'border-red-500/30',
      text: t('anonymity.notAnonymous'),
      description: t('anonymity.notAnonymousDesc'),
    },
  };

  const { icon: Icon, color, bgColor, borderColor, text, description } = config[level];

  const iconSize = size === 'sm' ? 'h-3 w-3' : 'h-4 w-4';

  if (showText) {
    return (
      <div className={`inline-flex items-center gap-2 px-2 py-1 rounded-md ${bgColor} border ${borderColor}`}>
        <Icon className={`${iconSize} ${color}`} />
        <div>
          <span className={`text-xs font-medium ${color}`}>{text}</span>
          <p className="text-[10px] text-muted-foreground leading-tight">{description}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`inline-flex items-center justify-center w-5 h-5 rounded-full ${bgColor}`} title={description}>
      <Icon className={`${iconSize} ${color}`} />
    </div>
  );
}
