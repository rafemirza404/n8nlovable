import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import Vapi from "@vapi-ai/web";
import { Phone, PhoneOff, Mic, MicOff, Check, Star, X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

interface LeadData {
  name: string;
  email: string;
  phone: string;
  company: string;
  role: string;
  consent: boolean;
  timestamp?: number;
  website_form_filled?: boolean;
}

const WEBHOOKS = {
  checkEligibility: "https://n8nlocal.supportagentblue.com/webhook/check-call-eligibility",
  saveProfile: "https://n8nlocal.supportagentblue.com/webhook/save-user-profile",
  lookupUser: "https://n8nlocal.supportagentblue.com/webhook/lookup-user",
  saveCallRecord: "https://n8nlocal.supportagentblue.com/webhook/save-call-record",
};

const COUNTRY_CODES = [
  { code: "+1", name: "USA" },
  { code: "+44", name: "UK" },
  { code: "+91", name: "India" },
  { code: "+971", name: "UAE" },
  { code: "+966", name: "Saudi Arabia" },
  { code: "+61", name: "Australia" },
  { code: "+49", name: "Germany" },
  { code: "+33", name: "France" },
];

const ROLES = [
  "Founder/CEO",
  "Operations Manager",
  "Operations Director",
  "Marketing Director",
  "Business Owner",
  "IT Manager",
  "Other",
];

const VoiceCallButton = () => {
  const navigate = useNavigate();
  const { toast } = useToast();

  // Modal states
  const [showEmailLookup, setShowEmailLookup] = useState(false);
  const [showLeadForm, setShowLeadForm] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [showIntroModal, setShowIntroModal] = useState(false);
  const [isCallActive, setIsCallActive] = useState(false);
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);

  // Call states
  const [callDuration, setCallDuration] = useState(0);
  const [callStatus, setCallStatus] = useState<"speaking" | "listening">("listening");
  const [isMuted, setIsMuted] = useState(false);
  const [callStartTime, setCallStartTime] = useState<Date | null>(null);
  const [vapiCallId, setVapiCallId] = useState<string>("");

  // Feedback states
  const [rating, setRating] = useState(0);
  const [feedbackText, setFeedbackText] = useState("");
  const [autoCloseCountdown, setAutoCloseCountdown] = useState(10);

  // Form states
  const [leadData, setLeadData] = useState<LeadData>({
    name: "",
    email: "",
    phone: "",
    company: "",
    role: "",
    consent: false,
  });
  const [countryCode, setCountryCode] = useState("+1");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [lookupEmail, setLookupEmail] = useState("");
  const [formErrors, setFormErrors] = useState<Partial<Record<keyof LeadData | "phoneNumber", string>>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  // CRITICAL FIX: Use ref to store pending call data to avoid state timing issues
  const pendingCallDataRef = useRef<LeadData | null>(null);
  const vapiRef = useRef<Vapi | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const feedbackTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Initialize Vapi
  useEffect(() => {
    vapiRef.current = new Vapi("722c44f3-0bdb-48c0-b04f-7dee42b7f1ca");
    const vapi = vapiRef.current;

    vapi.on("call-start", () => {
      console.log("Call started");
      setIsCallActive(true);
      setShowIntroModal(false);
      setCallStartTime(new Date());
      document.body.style.overflow = "hidden";

      timerRef.current = setInterval(() => {
        setCallDuration((prev) => prev + 1);
      }, 1000);
    });

    vapi.on("call-end", () => {
      console.log("Call ended");
      handleCallEnd();
    });

    vapi.on("speech-start", () => {
      console.log("Assistant started speaking");
      setCallStatus("speaking");
    });

    vapi.on("speech-end", () => {
      console.log("Assistant stopped speaking");
      setCallStatus("listening");
    });

    vapi.on("error", (error) => {
      console.error("Vapi error:", error);
      toast({
        title: "Call Error",
        description: "There was an issue with the call. Please try again.",
        variant: "destructive",
      });
      setIsCallActive(false);
      document.body.style.overflow = "auto";
    });

    vapi.on("message", (message: any) => {
      if (message.type === "call-started" && message.call?.id) {
        setVapiCallId(message.call.id);
      }
    });

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
      vapi.stop();
    };
  }, [toast]);

  // Auto-close countdown for feedback modal
  useEffect(() => {
    if (showFeedbackModal && autoCloseCountdown > 0) {
      const timer = setTimeout(() => {
        setAutoCloseCountdown(prev => prev - 1);
      }, 1000);

      return () => clearTimeout(timer);
    } else if (showFeedbackModal && autoCloseCountdown === 0) {
      handleCloseFeedback();
    }
  }, [showFeedbackModal, autoCloseCountdown]);

  // Reset countdown on user interaction
  const resetCountdown = useCallback(() => {
    setAutoCloseCountdown(10);
  }, []);

  const handleButtonClick = () => {
    // Check localStorage first
    const savedUser = localStorage.getItem('agentblue_user');

    if (savedUser) {
      try {
        const userData = JSON.parse(savedUser);
        setLeadData(userData);
        setShowConfirmation(true);
      } catch (error) {
        console.error("Error parsing saved user data:", error);
        setShowEmailLookup(true);
      }
    } else {
      setShowEmailLookup(true);
    }
  };

  const handleEmailLookup = async () => {
    if (!lookupEmail || !lookupEmail.includes("@")) {
      setFormErrors({ email: "Please enter a valid email address" });
      return;
    }

    setIsSubmitting(true);
    setFormErrors({});

    try {
      const response = await fetch(WEBHOOKS.lookupUser, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: lookupEmail }),
      });

      if (response.ok) {
        const userData = await response.json();
        if (userData && userData.found) {
          // User found
          const userProfile = {
            name: userData.data.name,
            email: userData.data.email,
            phone: userData.data.phone,
            company: userData.data.company,
            role: userData.data.role,
            consent: true,
            website_form_filled: userData.website_form_filled || false,
          };
          setLeadData(userProfile);
          localStorage.setItem('agentblue_user', JSON.stringify(userProfile));
          setShowEmailLookup(false);
          setShowConfirmation(true);
        } else {
          // User not found, show full form
          setLeadData(prev => ({ ...prev, email: lookupEmail }));
          setShowEmailLookup(false);
          setShowLeadForm(true);
        }
      } else {
        // Webhook failed, show full form
        setLeadData(prev => ({ ...prev, email: lookupEmail }));
        setShowEmailLookup(false);
        setShowLeadForm(true);
      }
    } catch (error) {
      console.error("Email lookup error:", error);
      // On error, show full form
      setLeadData(prev => ({ ...prev, email: lookupEmail }));
      setShowEmailLookup(false);
      setShowLeadForm(true);
    } finally {
      setIsSubmitting(false);
    }
  };

  const validateForm = (): boolean => {
    const errors: Partial<Record<keyof LeadData | "phoneNumber", string>> = {};

    if (!leadData.name || leadData.name.length < 2) {
      errors.name = "Name must be at least 2 characters";
    }

    if (!leadData.email || !leadData.email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
      errors.email = "Please enter a valid email address";
    }

    if (!phoneNumber || phoneNumber.length < 7) {
      errors.phoneNumber = "Please enter a valid phone number";
    }

    if (!leadData.company) {
      errors.company = "Company name is required";
    }

    if (!leadData.role) {
      errors.role = "Please select your role";
    }

    if (!leadData.consent) {
      errors.consent = "You must agree to receive follow-up communication";
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // FIX: Pass data explicitly through the chain instead of relying on state
  const handleFormSubmit = async () => {
    if (!validateForm()) return;

    const fullPhone = countryCode + phoneNumber;
    const updatedLeadData: LeadData = {
      ...leadData,
      phone: fullPhone,
      timestamp: Date.now(),
      website_form_filled: true
    };

    console.log("✅ Form submitted with data:", updatedLeadData);

    setIsSubmitting(true);

    // Update state for UI consistency
    setLeadData(updatedLeadData);

    // CRITICAL FIX: Store data in ref immediately for reliable access
    pendingCallDataRef.current = updatedLeadData;

    // Save to localStorage
    localStorage.setItem('agentblue_user', JSON.stringify(updatedLeadData));

    console.log("✅ Data saved to localStorage and ref");

    // Check rate limit with the exact data we just created
    await checkRateLimit(updatedLeadData);
  };

  const checkRateLimit = async (userData: LeadData) => {
    try {
      // Check localStorage first for quick rate limit
      const lastCall = localStorage.getItem('agentblue_last_call');
      if (lastCall) {
        const lastCallTime = parseInt(lastCall);
        const timeSinceLastCall = Date.now() - lastCallTime;
        const minutesSince = Math.floor(timeSinceLastCall / 60000);

        if (minutesSince < 60) {
          const minutesRemaining = 60 - minutesSince;
          toast({
            title: "Please wait",
            description: `Please wait ${minutesRemaining} minutes before your next call`,
            variant: "destructive",
          });
          setIsSubmitting(false);
          setShowLeadForm(false);
          return;
        }
      }

      // OPTIMIZATION: Make webhook calls non-blocking for better UX
      // Check rate limit and save profile in parallel
      const [eligibilityResponse] = await Promise.allSettled([
        fetch(WEBHOOKS.checkEligibility, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: userData.email,
            phone: userData.phone,
            timestamp: new Date().toISOString(),
          }),
        }),
        // Save profile in background - don't block user flow
        fetch(WEBHOOKS.saveProfile, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: userData.name,
            email: userData.email,
            phone: userData.phone,
            company: userData.company,
            role: userData.role,
          }),
        }).catch(err => console.error("Profile save failed:", err))
      ]);

      if (eligibilityResponse.status === 'fulfilled' && eligibilityResponse.value.ok) {
        const result = await eligibilityResponse.value.json();

        if (!result.allowed) {
          toast({
            title: "Rate Limit Reached",
            description: result.message || "Please wait before making another call",
            variant: "destructive",
          });
          setIsSubmitting(false);
          setShowLeadForm(false);
          return;
        }
      } else {
        console.log("Rate limit check failed, proceeding with localStorage fallback");
      }

      // CRITICAL FIX: Store data in ref again to ensure it's available for the call
      pendingCallDataRef.current = userData;

      // Proceed to intro modal
      console.log("✅ Proceeding to intro modal with userData:", userData);
      console.log("✅ Ref data stored:", pendingCallDataRef.current);

      setIsSubmitting(false);
      setShowLeadForm(false);
      setShowConfirmation(false);
      setShowIntroModal(true);
    } catch (error) {
      console.error("Rate limit check error:", error);
      // On error, allow call to proceed (don't block users)
      pendingCallDataRef.current = userData;
      setIsSubmitting(false);
      setShowLeadForm(false);
      setShowIntroModal(true);
    }
  };

  const handleConfirmedUser = async () => {
    console.log("✅ Confirmed user, current leadData:", leadData);

    // CRITICAL FIX: Store current leadData in ref before proceeding
    pendingCallDataRef.current = leadData;

    setShowConfirmation(false);
    await checkRateLimit(leadData);
  };

  // FIX: Use ref data instead of parameter to ensure we always have the latest data
  const handleStartCall = async () => {
    try {
      // CRITICAL FIX: Use data from ref, which is guaranteed to be the latest
      const callData = pendingCallDataRef.current;

      if (!callData) {
        console.error("❌ No call data available in ref!");
        toast({
          title: "Error",
          description: "Call data is missing. Please try again.",
          variant: "destructive",
        });
        setShowIntroModal(false);
        return;
      }

      console.log("✅ Starting call with data from ref:", callData);
      console.log("✅ Variables to send to VAPI:", {
        name: callData.name,
        email: callData.email,
        company: callData.company,
        role: callData.role,
        phone: callData.phone,
        callSource: "website",
      });

      // FIX: Use exact format from VAPI GitHub docs
      const assistantOverrides = {
        variableValues: {
          name: callData.name,
          email: callData.email,
          company: callData.company,
          role: callData.role,
          phone: callData.phone,
          callSource: "website",
        },
      };

      console.log("✅ Calling vapi.start() with overrides:", assistantOverrides);

      await vapiRef.current?.start("a2cc1d26-9117-436f-a991-15b6d80de3b1", assistantOverrides);

      // Save last call time
      localStorage.setItem('agentblue_last_call', Date.now().toString());

      console.log("✅ Call started successfully!");
    } catch (error) {
      console.error("❌ Failed to start call:", error);
      toast({
        title: "Failed to Start Call",
        description: "Please check your microphone permissions and try again.",
        variant: "destructive",
      });
      setShowIntroModal(false);
    }
  };

  const handleEndCall = () => {
    vapiRef.current?.stop();
  };

  const handleCallEnd = () => {
    setIsCallActive(false);
    document.body.style.overflow = "auto";

    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    const callEndTime = new Date();

    // Save call record immediately
    saveCallRecord(callEndTime);

    // Show feedback modal
    setShowFeedbackModal(true);
    setAutoCloseCountdown(10);
  };

  const saveCallRecord = async (endTime: Date) => {
    // Use ref data to ensure we have the correct call data
    const callData = pendingCallDataRef.current || leadData;

    try {
      await fetch(WEBHOOKS.saveCallRecord, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lead_data: {
            name: callData.name,
            email: callData.email,
            phone: callData.phone,
            company: callData.company,
            role: callData.role,
          },
          call_data: {
            started_at: callStartTime?.toISOString(),
            ended_at: endTime.toISOString(),
            duration: formatTime(callDuration),
            vapi_call_id: vapiCallId || null,
          },
          feedback: {
            rating: rating || null,
            comment: feedbackText || "",
            next_action: null,
          },
        }),
      });
    } catch (error) {
      console.error("Error saving call record:", error);
    }
  };

  const handleFeedbackSubmit = async () => {
    resetCountdown();

    const callData = pendingCallDataRef.current || leadData;

    // Update call record with feedback
    try {
      await fetch(WEBHOOKS.saveCallRecord, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lead_data: {
            name: callData.name,
            email: callData.email,
            phone: callData.phone,
            company: callData.company,
            role: callData.role,
          },
          call_data: {
            started_at: callStartTime?.toISOString(),
            ended_at: new Date().toISOString(),
            duration: formatTime(callDuration),
            vapi_call_id: vapiCallId || null,
          },
          feedback: {
            rating: rating,
            comment: feedbackText,
            next_action: "submitted",
          },
        }),
      });
    } catch (error) {
      console.error("Error updating feedback:", error);
    }

    toast({
      title: "Thank you!",
      description: "Your feedback has been recorded.",
    });

    handleCloseFeedback();
  };

  const handleExploreServices = async () => {
    resetCountdown();

    const callData = pendingCallDataRef.current || leadData;

    // Update call record with action
    try {
      await fetch(WEBHOOKS.saveCallRecord, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lead_data: {
            name: callData.name,
            email: callData.email,
            phone: callData.phone,
            company: callData.company,
            role: callData.role,
          },
          call_data: {
            started_at: callStartTime?.toISOString(),
            ended_at: new Date().toISOString(),
            duration: formatTime(callDuration),
            vapi_call_id: vapiCallId || null,
          },
          feedback: {
            rating: rating || null,
            comment: feedbackText || "",
            next_action: "explore_services",
          },
        }),
      });
    } catch (error) {
      console.error("Error updating action:", error);
    }

    setShowFeedbackModal(false);
    navigate("/services");
  };

  const handleCloseFeedback = () => {
    setShowFeedbackModal(false);
    setRating(0);
    setFeedbackText("");
    setCallDuration(0);
    setAutoCloseCountdown(10);
  };

  const toggleMute = () => {
    if (vapiRef.current) {
      vapiRef.current.setMuted(!isMuted);
      setIsMuted(!isMuted);
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <>
      {/* Floating Button */}
      {!isCallActive && (
        <button
          onClick={handleButtonClick}
          className="fixed bottom-6 left-6 z-[9997] bg-[#0066FF] hover:bg-[#0052CC] text-white rounded-full px-4 py-2.5 sm:px-5 sm:py-3 shadow-lg transition-all duration-300 hover:shadow-xl group"
          aria-label="Talk to Sophia AI"
        >
          <div className="flex items-center gap-2 sm:gap-3 justify-center">
            <Phone className="w-4 h-4 sm:w-5 sm:h-5 flex-shrink-0" />
            <div className="flex flex-col items-start text-left">
              <span className="font-semibold text-xs sm:text-sm leading-tight">Talk to Sophia</span>
              <span className="text-[10px] sm:text-xs text-white/80 leading-tight whitespace-nowrap">2-min consultation</span>
            </div>
          </div>
        </button>
      )}

      {/* Email Lookup Modal */}
      <Dialog open={showEmailLookup} onOpenChange={setShowEmailLookup}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-2xl">Welcome back!</DialogTitle>
            <DialogDescription className="text-base pt-2">
              Enter your email to continue
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="lookup-email">Email Address</Label>
              <Input
                id="lookup-email"
                type="email"
                placeholder="john@company.com"
                value={lookupEmail}
                onChange={(e) => setLookupEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleEmailLookup()}
                className={formErrors.email ? "border-red-500" : ""}
              />
              {formErrors.email && (
                <p className="text-sm text-red-500">{formErrors.email}</p>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-3 pt-4">
            <Button
              onClick={handleEmailLookup}
              disabled={isSubmitting}
              className="w-full bg-[#0066FF] hover:bg-[#0052CC]"
            >
              {isSubmitting ? "Looking up..." : "Continue"}
            </Button>
            <Button
              onClick={() => {
                setShowEmailLookup(false);
                setShowLeadForm(true);
              }}
              variant="ghost"
              className="w-full"
            >
              I'm new here
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Lead Capture Form */}
      <Dialog open={showLeadForm} onOpenChange={setShowLeadForm}>
        <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-2xl">Connect with Sophia AI</DialogTitle>
            <DialogDescription className="text-base pt-2">
              Quick details to get started
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Full Name */}
            <div className="space-y-2">
              <Label htmlFor="name">Full Name *</Label>
              <Input
                id="name"
                placeholder="John Smith"
                value={leadData.name}
                onChange={(e) => setLeadData({ ...leadData, name: e.target.value })}
                className={formErrors.name ? "border-red-500" : ""}
              />
              {formErrors.name && (
                <p className="text-sm text-red-500">{formErrors.name}</p>
              )}
            </div>

            {/* Business Email */}
            <div className="space-y-2">
              <Label htmlFor="email">Business Email *</Label>
              <Input
                id="email"
                type="email"
                placeholder="john@company.com"
                value={leadData.email}
                onChange={(e) => setLeadData({ ...leadData, email: e.target.value })}
                className={formErrors.email ? "border-red-500" : ""}
              />
              {formErrors.email && (
                <p className="text-sm text-red-500">{formErrors.email}</p>
              )}
            </div>

            {/* Phone Number */}
            <div className="space-y-2">
              <Label htmlFor="phone">Phone Number *</Label>
              <div className="flex gap-2">
                <Select value={countryCode} onValueChange={setCountryCode}>
                  <SelectTrigger className="w-[120px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {COUNTRY_CODES.map((country) => (
                      <SelectItem key={country.code} value={country.code}>
                        {country.code} ({country.name})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  id="phone"
                  type="tel"
                  placeholder="2025551234"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value.replace(/\D/g, ""))}
                  className={formErrors.phoneNumber ? "border-red-500 flex-1" : "flex-1"}
                />
              </div>
              {formErrors.phoneNumber && (
                <p className="text-sm text-red-500">{formErrors.phoneNumber}</p>
              )}
              <p className="text-xs text-gray-500">
                Combined: {countryCode} {phoneNumber}
              </p>
            </div>

            {/* Company Name */}
            <div className="space-y-2">
              <Label htmlFor="company">Company Name *</Label>
              <Input
                id="company"
                placeholder="Acme Inc."
                value={leadData.company}
                onChange={(e) => setLeadData({ ...leadData, company: e.target.value })}
                className={formErrors.company ? "border-red-500" : ""}
              />
              {formErrors.company && (
                <p className="text-sm text-red-500">{formErrors.company}</p>
              )}
            </div>

            {/* Role */}
            <div className="space-y-2">
              <Label htmlFor="role">Your Role *</Label>
              <Select
                value={leadData.role}
                onValueChange={(value) => setLeadData({ ...leadData, role: value })}
              >
                <SelectTrigger className={formErrors.role ? "border-red-500" : ""}>
                  <SelectValue placeholder="Select your role" />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map((role) => (
                    <SelectItem key={role} value={role}>
                      {role}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {formErrors.role && (
                <p className="text-sm text-red-500">{formErrors.role}</p>
              )}
            </div>

            {/* Consent */}
            <div className="flex items-start space-x-2">
              <Checkbox
                id="consent"
                checked={leadData.consent}
                onCheckedChange={(checked) =>
                  setLeadData({ ...leadData, consent: checked as boolean })
                }
              />
              <label
                htmlFor="consent"
                className="text-sm leading-tight cursor-pointer"
              >
                I agree to receive follow-up communication from AgentBlue *
              </label>
            </div>
            {formErrors.consent && (
              <p className="text-sm text-red-500">{formErrors.consent}</p>
            )}
          </div>

          <div className="flex gap-3 pt-4">
            <Button
              onClick={() => setShowLeadForm(false)}
              variant="outline"
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              onClick={handleFormSubmit}
              disabled={isSubmitting}
              className="flex-1 bg-[#0066FF] hover:bg-[#0052CC]"
            >
              {isSubmitting ? "Processing..." : "Continue"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Confirmation Modal for Returning Users */}
      <Dialog open={showConfirmation} onOpenChange={setShowConfirmation}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-2xl">Welcome back, {leadData.name}!</DialogTitle>
            <DialogDescription className="text-base pt-2">
              {leadData.website_form_filled
                ? "Ready to speak with Sophia again?"
                : "We have your info from a previous interaction. Ready to speak with Sophia?"}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-4">
            <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4 space-y-2 text-sm">
              <p><strong>Email:</strong> {leadData.email}</p>
              <p><strong>Company:</strong> {leadData.company}</p>
              <p><strong>Role:</strong> {leadData.role}</p>
            </div>
          </div>

          <div className="flex gap-3 pt-4">
            <Button
              onClick={() => {
                setShowConfirmation(false);
                setShowLeadForm(true);
              }}
              variant="outline"
              className="flex-1"
            >
              Update Info
            </Button>
            <Button
              onClick={handleConfirmedUser}
              className="flex-1 bg-[#0066FF] hover:bg-[#0052CC]"
            >
              <Phone className="w-4 h-4 mr-2" />
              Start Call
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Intro Modal */}
      <Dialog open={showIntroModal} onOpenChange={setShowIntroModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-2xl">Connect with Sophia AI</DialogTitle>
            <DialogDescription className="text-base pt-2">
              You're about to speak with our AI automation expert. She'll ask about your
              business and explain how we can help.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-4">
            <div className="flex items-start gap-3 text-sm">
              <Check className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
              <span className="text-gray-700 dark:text-gray-300">
                Make sure you're in a quiet environment
              </span>
            </div>
            <div className="flex items-start gap-3 text-sm">
              <Check className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
              <span className="text-gray-700 dark:text-gray-300">
                Allow microphone access when prompted
              </span>
            </div>
            <div className="flex items-start gap-3 text-sm">
              <Check className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
              <span className="text-gray-700 dark:text-gray-300">
                The call typically takes 2-3 minutes
              </span>
            </div>
          </div>

          <div className="flex gap-3 pt-4">
            <Button
              onClick={() => setShowIntroModal(false)}
              variant="outline"
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              onClick={handleStartCall}
              className="flex-1 bg-[#0066FF] hover:bg-[#0052CC]"
            >
              <Phone className="w-4 h-4 mr-2" />
              Start Voice Call
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* During Call - Live Status Card */}
      {isCallActive && (
        <>
          <div className="fixed inset-0 bg-black/40 z-[9996]" />

          <div className="fixed bottom-6 left-6 z-[9997] bg-white dark:bg-gray-900 rounded-2xl p-6 shadow-2xl border-2 border-[#0066FF] animate-pulse-glow w-[280px]">
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse" />
                <span className="font-semibold text-gray-900 dark:text-white">
                  Connected to Sophia
                </span>
              </div>

              <div className="flex items-center justify-center gap-1 h-16">
                {[...Array(5)].map((_, i) => (
                  <div
                    key={i}
                    className="w-2 bg-[#0066FF] rounded-full animate-waveform"
                    style={{
                      animationDelay: `${i * 0.1}s`,
                      height: "20px",
                    }}
                  />
                ))}
              </div>

              <div className="text-center space-y-2">
                <div className="flex items-center justify-center gap-2 text-gray-700 dark:text-gray-300">
                  {callStatus === "speaking" ? (
                    <>
                      <Mic className="w-4 h-4" />
                      <span>Sophia is speaking...</span>
                    </>
                  ) : (
                    <>
                      <Mic className="w-4 h-4 text-green-500" />
                      <span>Listening to you...</span>
                    </>
                  )}
                </div>
                <div className="text-2xl font-mono text-gray-900 dark:text-white">
                  {formatTime(callDuration)}
                </div>
              </div>

              <div className="flex gap-2">
                <Button
                  onClick={toggleMute}
                  variant="outline"
                  size="sm"
                  className="flex-1"
                >
                  {isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                </Button>
                <Button
                  onClick={handleEndCall}
                  className="flex-1 bg-red-500 hover:bg-red-600 text-white"
                >
                  <PhoneOff className="w-4 h-4 mr-2" />
                  End Call
                </Button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Feedback Modal */}
      <Dialog open={showFeedbackModal} onOpenChange={setShowFeedbackModal}>
        <DialogContent
          className="sm:max-w-md"
          onClick={resetCountdown}
          onKeyDown={resetCountdown}
        >
          <div className="text-center space-y-4 py-4">
            <div className="flex justify-center">
              <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center">
                <Check className="w-8 h-8 text-green-600 dark:text-green-500" />
              </div>
            </div>

            <div className="space-y-2">
              <h3 className="text-2xl font-semibold text-gray-900 dark:text-white">
                Thanks for speaking with Sophia!
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Your consultation summary will be sent to your email
              </p>
            </div>

            <div className="space-y-3 pt-4">
              <p className="font-medium text-gray-900 dark:text-white">
                How was your experience?
              </p>
              <div className="flex justify-center gap-2">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    onClick={() => {
                      setRating(star);
                      resetCountdown();
                    }}
                    className="transition-transform hover:scale-110"
                  >
                    <Star
                      className={`w-8 h-8 ${
                        star <= rating
                          ? "fill-yellow-400 text-yellow-400"
                          : "text-gray-300 dark:text-gray-600"
                      }`}
                    />
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2 pt-2">
              <Textarea
                placeholder="Any additional feedback? (optional)"
                value={feedbackText}
                onChange={(e) => {
                  setFeedbackText(e.target.value);
                  resetCountdown();
                }}
                maxLength={500}
                className="min-h-[80px]"
              />
              <p className="text-xs text-gray-500 text-right">
                {feedbackText.length}/500
              </p>
            </div>

            <div className="space-y-3 pt-4">
              <Button
                onClick={handleExploreServices}
                className="w-full bg-[#0066FF] hover:bg-[#0052CC]"
              >
                Explore Our Services
              </Button>

              {rating > 0 && (
                <Button
                  onClick={handleFeedbackSubmit}
                  variant="outline"
                  className="w-full"
                >
                  Submit Feedback
                </Button>
              )}
            </div>

            <div className="pt-2 space-y-2">
              <p className="text-sm text-gray-500">
                Closing in {autoCloseCountdown} seconds...
              </p>
              <button
                onClick={handleCloseFeedback}
                className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
              >
                Close
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <style>{`
        @keyframes waveform {
          0%, 100% { height: 8px; }
          50% { height: 32px; }
        }

        @keyframes pulse-glow {
          0%, 100% { box-shadow: 0 0 20px rgba(0, 102, 255, 0.3); }
          50% { box-shadow: 0 0 40px rgba(0, 102, 255, 0.6); }
        }

        .animate-waveform {
          animation: waveform 1s ease-in-out infinite;
        }

        .animate-pulse-glow {
          animation: pulse-glow 2s ease-in-out infinite;
        }
      `}</style>
    </>
  );
};

export default VoiceCallButton;
