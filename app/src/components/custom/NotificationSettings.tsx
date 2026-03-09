import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  Bell,
  Volume2,
  Vibrate,
  Eye,
  AlertTriangle,
  ExternalLink,
  Check,
  X,
  ChevronDown,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import type { NotificationSettings as NotificationSettingsType } from '@/types';
import {
  checkNotificationPermission,
  requestNotificationPermission,
  openSystemNotificationSettings,
  loadNotificationSettings,
  saveNotificationSettings,
  type NotificationPermission,
} from '@/services/notificationService';

interface NotificationSettingsProps {
  className?: string;
}

export function NotificationSettings({ className }: NotificationSettingsProps) {
  const { t } = useTranslation();
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [settings, setSettings] = useState<NotificationSettingsType>({
    enabled: true,
    sound: true,
    vibration: true,
    showPreview: true,
    priority: 'normal',
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isExpanded, setIsExpanded] = useState(false);

  // Load settings and permission on mount
  useEffect(() => {
    const loadData = async () => {
      setIsLoading(true);
      try {
        const [perm, savedSettings] = await Promise.all([
          checkNotificationPermission(),
          loadNotificationSettings(),
        ]);
        setPermission(perm);
        setSettings(savedSettings);
      } catch (error) {
        console.error('[NotificationSettings] Failed to load data:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadData();
  }, []);

  // Update a single setting
  const updateSetting = useCallback(async <K extends keyof NotificationSettingsType>(
    key: K,
    value: NotificationSettingsType[K]
  ) => {
    const newSettings = { ...settings, [key]: value };
    setSettings(newSettings);

    try {
      await saveNotificationSettings({ [key]: value });

      // Show feedback for certain changes
      if (key === 'enabled' && value === true) {
        const perm = await checkNotificationPermission();
        if (perm !== 'granted') {
          toast.info(t('notifications.requestingPermission'));
          const newPerm = await requestNotificationPermission();
          setPermission(newPerm);
          if (newPerm !== 'granted') {
            toast.error(t('notifications.permissionDenied'));
            // Revert the setting
            setSettings(prev => ({ ...prev, enabled: false }));
            await saveNotificationSettings({ enabled: false });
          } else {
            toast.success(t('notifications.enabled'));
          }
        } else {
          toast.success(t('notifications.enabled'));
        }
      } else if (key === 'enabled' && value === false) {
        toast.info(t('notifications.disabled'));
      }
    } catch (error) {
      console.error('[NotificationSettings] Failed to save setting:', error);
      toast.error(t('notifications.saveError'));
      // Revert on error
      setSettings(settings);
    }
  }, [settings, t]);

  // Handle opening system settings
  const handleOpenSystemSettings = async () => {
    try {
      await openSystemNotificationSettings();
    } catch (error) {
      console.error('[NotificationSettings] Failed to open settings:', error);
      toast.error(t('notifications.openSettingsError'));
    }
  };

  // Get permission status display
  const getPermissionStatus = () => {
    switch (permission) {
      case 'granted':
        return {
          icon: <Check className="h-4 w-4 text-green-500" />,
          text: t('notifications.permissionGranted'),
          color: 'text-green-500',
        };
      case 'denied':
        return {
          icon: <X className="h-4 w-4 text-destructive" />,
          text: t('notifications.permissionDenied'),
          color: 'text-destructive',
        };
      case 'unsupported':
        return {
          icon: <AlertTriangle className="h-4 w-4 text-amber-500" />,
          text: t('notifications.notSupported'),
          color: 'text-amber-500',
        };
      case 'default':
      default:
        return {
          icon: <AlertTriangle className="h-4 w-4 text-muted-foreground" />,
          text: t('notifications.permissionDefault'),
          color: 'text-muted-foreground',
        };
    }
  };

  const permStatus = getPermissionStatus();

  if (isLoading) {
    return (
      <div className={`space-y-4 ${className || ''}`}>
        <div className="animate-pulse space-y-3">
          <div className="h-12 bg-muted rounded-lg" />
          <div className="h-12 bg-muted rounded-lg" />
          <div className="h-12 bg-muted rounded-lg" />
        </div>
      </div>
    );
  }

  return (
    <div className={`space-y-4 ${className || ''}`}>
      {/* Permission Status Banner */}
      <div className="p-3 rounded-lg bg-muted/50 border border-border">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {permStatus.icon}
            <span className={`text-sm ${permStatus.color}`}>{permStatus.text}</span>
          </div>
          {permission === 'denied' && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleOpenSystemSettings}
              className="h-8 text-xs"
            >
              <ExternalLink className="h-3 w-3 mr-1" />
              {t('notifications.openSettings')}
            </Button>
          )}
        </div>
      </div>

      {/* Main Toggle - Full Width for Mobile */}
      <div className="flex items-center justify-between p-4 rounded-lg border border-border bg-card touch-manipulation"
      >
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-full bg-primary/10">
            <Bell className="h-5 w-5 text-primary" />
          </div>
          <div>
            <p className="font-medium">{t('notifications.enable')}</p>
            <p className="text-sm text-muted-foreground">{t('notifications.enableDesc')}</p>
          </div>
        </div>
        <Switch
          checked={settings.enabled}
          onCheckedChange={(checked) => updateSetting('enabled', checked)}
          disabled={permission === 'unsupported'}
          className="data-[state=checked]:bg-primary"
        />
      </div>

      {/* Advanced Settings - Collapsible */}
      <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
        <CollapsibleTrigger asChild>
          <button className="w-full flex items-center justify-between p-3 rounded-lg border border-border hover:bg-accent transition-colors"
          >
            <span className="text-sm font-medium">{t('notifications.advanced')}</span>
            <ChevronDown
              className={`h-4 w-4 text-muted-foreground transition-transform ${isExpanded ? 'rotate-180' : ''}`}
            />
          </button>
        </CollapsibleTrigger>

        <CollapsibleContent className="space-y-3 mt-3">
          {/* Sound Toggle */}
          <div className="flex items-center justify-between p-4 rounded-lg border border-border bg-card touch-manipulation"
          >
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-full bg-primary/10">
                <Volume2 className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="font-medium">{t('notifications.sound')}</p>
                <p className="text-sm text-muted-foreground">{t('notifications.soundDesc')}</p>
              </div>
            </div>
            <Switch
              checked={settings.sound}
              onCheckedChange={(checked) => updateSetting('sound', checked)}
              disabled={!settings.enabled}
            />
          </div>

          {/* Vibration Toggle */}
          <div className="flex items-center justify-between p-4 rounded-lg border border-border bg-card touch-manipulation"
          >
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-full bg-primary/10">
                <Vibrate className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="font-medium">{t('notifications.vibration')}</p>
                <p className="text-sm text-muted-foreground">{t('notifications.vibrationDesc')}</p>
              </div>
            </div>
            <Switch
              checked={settings.vibration}
              onCheckedChange={(checked) => updateSetting('vibration', checked)}
              disabled={!settings.enabled}
            />
          </div>

          {/* Show Preview Toggle */}
          <div className="flex items-center justify-between p-4 rounded-lg border border-border bg-card touch-manipulation"
          >
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-full bg-primary/10">
                <Eye className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="font-medium">{t('notifications.showPreview')}</p>
                <p className="text-sm text-muted-foreground">{t('notifications.showPreviewDesc')}</p>
              </div>
            </div>
            <Switch
              checked={settings.showPreview}
              onCheckedChange={(checked) => updateSetting('showPreview', checked)}
              disabled={!settings.enabled}
            />
          </div>

          {/* Priority Selector */}
          <div className="p-4 rounded-lg border border-border bg-card"
          >
            <div className="mb-3">
              <p className="font-medium">{t('notifications.priority')}</p>
              <p className="text-sm text-muted-foreground">{t('notifications.priorityDesc')}</p>
            </div>
            <Select
              value={settings.priority}
              onValueChange={(value: NotificationSettingsType['priority']) =>
                updateSetting('priority', value)
              }
              disabled={!settings.enabled}
            >
              <SelectTrigger className="w-full h-12">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="high">{t('notifications.priorityHigh')}</SelectItem>
                <SelectItem value="normal">{t('notifications.priorityNormal')}</SelectItem>
                <SelectItem value="low">{t('notifications.priorityLow')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
