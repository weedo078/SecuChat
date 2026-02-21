import { Shield, AlertTriangle, Wifi } from 'lucide-react';

interface AnonymityBadgeProps {
  level: 'green' | 'yellow' | 'red';
  size?: 'sm' | 'md';
  showText?: boolean;
}

export function AnonymityBadge({ level, size = 'sm', showText = false }: AnonymityBadgeProps) {
  const config = {
    green: {
      icon: Shield,
      color: 'text-green-500',
      bgColor: 'bg-green-500/10',
      borderColor: 'border-green-500/30',
      text: 'Anonym',
      description: 'IP durch I2P verborgen',
    },
    yellow: {
      icon: Wifi,
      color: 'text-yellow-500',
      bgColor: 'bg-yellow-500/10',
      borderColor: 'border-yellow-500/30',
      text: 'LAN',
      description: 'Nur im lokalen Netzwerk',
    },
    red: {
      icon: AlertTriangle,
      color: 'text-red-500',
      bgColor: 'bg-red-500/10',
      borderColor: 'border-red-500/30',
      text: 'Nicht anonym',
      description: 'IP-Adresse sichtbar',
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
