import { AppHeader } from '@/components/layout/AppHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from '@/hooks/use-toast';
import { Save, Mail, Bell, Shield, Sliders } from 'lucide-react';

export default function Settings() {
  const handleSave = () => {
    toast({
      title: 'Settings Saved',
      description: 'Your settings have been updated successfully.',
    });
  };

  return (
    <div className="flex flex-col h-full">
      <AppHeader title="Settings" subtitle="Configure your system" />

      <div className="flex-1 overflow-y-auto p-6 scrollbar-thin">
        <Tabs defaultValue="general" className="space-y-6">
          <TabsList>
            <TabsTrigger value="general">
              <Sliders className="h-4 w-4 mr-2" />
              General
            </TabsTrigger>
            <TabsTrigger value="email">
              <Mail className="h-4 w-4 mr-2" />
              Email Templates
            </TabsTrigger>
            <TabsTrigger value="notifications">
              <Bell className="h-4 w-4 mr-2" />
              Notifications
            </TabsTrigger>
            <TabsTrigger value="rules">
              <Shield className="h-4 w-4 mr-2" />
              Business Rules
            </TabsTrigger>
          </TabsList>

          <TabsContent value="general">
            <Card>
              <CardHeader>
                <CardTitle>General Settings</CardTitle>
                <CardDescription>
                  Configure basic system preferences
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label>Company Name</Label>
                    <Input defaultValue="AutoFin Services" />
                  </div>
                  <div className="space-y-2">
                    <Label>Support Email</Label>
                    <Input defaultValue="support@autofinance.com" />
                  </div>
                  <div className="space-y-2">
                    <Label>Default APR Range</Label>
                    <div className="flex items-center gap-2">
                      <Input type="number" defaultValue="4.0" className="w-24" />
                      <span>to</span>
                      <Input type="number" defaultValue="18.0" className="w-24" />
                      <span>%</span>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Default Term Options</Label>
                    <Input defaultValue="36, 48, 60, 72, 84" />
                  </div>
                </div>
                <Button onClick={handleSave}>
                  <Save className="h-4 w-4 mr-2" />
                  Save Changes
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="email">
            <Card>
              <CardHeader>
                <CardTitle>Email Templates</CardTitle>
                <CardDescription>
                  Customize automated email notifications
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>Template Type</Label>
                    <Select defaultValue="submission">
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="submission">
                          Deal Submission Confirmation
                        </SelectItem>
                        <SelectItem value="docs_needed">
                          Documents Needed
                        </SelectItem>
                        <SelectItem value="approved">Deal Approved</SelectItem>
                        <SelectItem value="declined">Deal Declined</SelectItem>
                        <SelectItem value="funded">Funding Confirmation</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Subject Line</Label>
                    <Input defaultValue="Your Auto Financing Application - {{deal_number}}" />
                  </div>

                  <div className="space-y-2">
                    <Label>Email Body</Label>
                    <Textarea
                      rows={10}
                      defaultValue={`Dear {{customer_name}},

Thank you for submitting your auto financing application. Your deal number is {{deal_number}}.

Vehicle: {{vehicle_year}} {{vehicle_make}} {{vehicle_model}}
Loan Amount: {{loan_amount}}

We will review your application and contact you within 24-48 hours.

Best regards,
AutoFin Services`}
                    />
                  </div>

                  <div className="text-xs text-muted-foreground">
                    Available merge fields: {`{{customer_name}}, {{deal_number}}, {{vehicle_year}}, {{vehicle_make}}, {{vehicle_model}}, {{loan_amount}}, {{dealer_name}}`}
                  </div>
                </div>
                <Button onClick={handleSave}>
                  <Save className="h-4 w-4 mr-2" />
                  Save Template
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="notifications">
            <Card>
              <CardHeader>
                <CardTitle>Notification Preferences</CardTitle>
                <CardDescription>
                  Configure when and how notifications are sent
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">New Deal Submissions</p>
                      <p className="text-sm text-muted-foreground">
                        Notify when a new deal is submitted
                      </p>
                    </div>
                    <Switch defaultChecked />
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">Deal Status Changes</p>
                      <p className="text-sm text-muted-foreground">
                        Notify when a deal moves to a new stage
                      </p>
                    </div>
                    <Switch defaultChecked />
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">Document Uploads</p>
                      <p className="text-sm text-muted-foreground">
                        Notify when new documents are uploaded
                      </p>
                    </div>
                    <Switch defaultChecked />
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">Stale Deal Alerts</p>
                      <p className="text-sm text-muted-foreground">
                        Notify when a deal is stuck in a stage for too long
                      </p>
                    </div>
                    <Switch defaultChecked />
                  </div>

                  <div className="space-y-2">
                    <Label>Stale Deal Threshold (days)</Label>
                    <Input type="number" defaultValue="3" className="w-24" />
                  </div>
                </div>
                <Button onClick={handleSave}>
                  <Save className="h-4 w-4 mr-2" />
                  Save Preferences
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="rules">
            <Card>
              <CardHeader>
                <CardTitle>Business Rules Engine</CardTitle>
                <CardDescription>
                  Configure automated decision triggers and routing rules
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-4">
                  <h3 className="font-semibold">Credit Score Thresholds</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Auto-Approve Minimum Score</Label>
                      <Input type="number" defaultValue="720" />
                    </div>
                    <div className="space-y-2">
                      <Label>Manual Review Required Below</Label>
                      <Input type="number" defaultValue="620" />
                    </div>
                    <div className="space-y-2">
                      <Label>Auto-Decline Below</Label>
                      <Input type="number" defaultValue="550" />
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <h3 className="font-semibold">LTV Limits</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Maximum LTV - New Vehicles</Label>
                      <div className="flex items-center gap-2">
                        <Input type="number" defaultValue="120" className="w-24" />
                        <span>%</span>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>Maximum LTV - Used Vehicles</Label>
                      <div className="flex items-center gap-2">
                        <Input type="number" defaultValue="110" className="w-24" />
                        <span>%</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <h3 className="font-semibold">Approval Tiers</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Standard Approval Limit</Label>
                      <Input type="number" defaultValue="50000" />
                    </div>
                    <div className="space-y-2">
                      <Label>Manager Approval Required Above</Label>
                      <Input type="number" defaultValue="75000" />
                    </div>
                  </div>
                </div>

                <Button onClick={handleSave}>
                  <Save className="h-4 w-4 mr-2" />
                  Save Rules
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
