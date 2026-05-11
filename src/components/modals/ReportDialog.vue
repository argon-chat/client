<template>
  <Dialog v-model:open="open">
    <DialogContent class="max-w-[440px] w-[95vw] p-0 overflow-hidden flex flex-col" @interactOutside.prevent @closeAutoFocus.prevent>
      <DialogHeader class="p-4 pb-2 flex-shrink-0">
        <DialogTitle>{{ t('report_dialog_title') }}</DialogTitle>
      </DialogHeader>

      <div class="flex-1 px-4 pb-4 overflow-y-auto min-h-0">

        <!-- ── Step: Category ── -->
        <div v-if="step === 'category'">
          <p class="text-sm text-muted-foreground mb-3">{{ t('report_step_category') }}</p>
          <div class="flex flex-col gap-1.5">
            <button
              v-for="cat in categoryList"
              :key="cat.value"
              class="flex items-center gap-3 px-3 py-2.5 rounded-lg text-left text-sm transition-colors hover:bg-muted/80 border border-transparent hover:border-border/40"
              @click="selectCategory(cat.value)"
            >
              <component :is="cat.icon" class="w-4 h-4 text-muted-foreground shrink-0" />
              <span>{{ cat.label }}</span>
            </button>
          </div>
        </div>

        <!-- ── Step: Reason ── -->
        <div v-if="step === 'reason'">
          <p class="text-sm text-muted-foreground mb-3">{{ t('report_step_reason') }}</p>
          <div class="flex flex-col gap-1.5">
            <button
              v-for="r in reasonList"
              :key="r.value"
              class="flex items-center gap-3 px-3 py-2.5 rounded-lg text-left text-sm transition-colors hover:bg-muted/80 border border-transparent hover:border-border/40"
              @click="selectReason(r.value)"
            >
              <span>{{ r.label }}</span>
            </button>
          </div>
        </div>

        <!-- ── Step: Comment ── -->
        <div v-if="step === 'comment'">
          <p class="text-sm text-muted-foreground mb-3">{{ t('report_step_comment') }}</p>
          <textarea
            v-model="additionalInfo"
            :placeholder="t('report_comment_placeholder')"
            class="w-full min-h-[100px] rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
            maxlength="1000"
          />
        </div>

        <!-- ── Step: Submitting ── -->
        <div v-if="step === 'submitting'" class="flex flex-col items-center justify-center py-8 gap-3">
          <Loader2 class="w-8 h-8 animate-spin text-muted-foreground" />
          <p class="text-sm text-muted-foreground">{{ t('report_submitting') }}</p>
        </div>

        <!-- ── Step: Success ── -->
        <div v-if="step === 'success'" class="flex flex-col items-center justify-center py-8 gap-3">
          <CheckCircle2 class="w-10 h-10 text-green-500" />
          <p class="text-sm font-medium">{{ t('report_success_title') }}</p>
          <p class="text-xs text-muted-foreground text-center">{{ t('report_success_desc') }}</p>
        </div>

        <!-- ── Step: Error ── -->
        <div v-if="step === 'error'" class="flex flex-col items-center justify-center py-8 gap-3">
          <XCircle class="w-10 h-10 text-destructive" />
          <p class="text-sm text-destructive text-center">{{ errorMessage }}</p>
        </div>
      </div>

      <!-- ── Footer ── -->
      <DialogFooter v-if="step === 'comment' || step === 'reason' || step === 'success' || step === 'error'" class="px-4 pb-4 pt-0">
        <div class="flex w-full gap-2">
          <Button
            v-if="step === 'comment' || step === 'reason'"
            variant="ghost"
            size="sm"
            @click="goBack"
          >
            {{ t('report_back') }}
          </Button>
          <div class="flex-1" />
          <Button
            v-if="step === 'comment'"
            size="sm"
            @click="submitReport"
          >
            {{ t('report_submit') }}
          </Button>
          <Button
            v-if="step === 'success' || step === 'error'"
            size="sm"
            @click="open = false"
          >
            {{ t('close') }}
          </Button>
        </div>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from "vue";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@argon/ui/dialog";
import { Button } from "@argon/ui/button";
import { useLocale } from "@/store/system/localeStore";
import { useApi } from "@/store/system/apiStore";
import {
  ReportCategory,
  ReportReason,
  ReportTargetKind,
  SubmitReportError,
  type CreateReportInput,
  type ReportTarget,
} from "@argon/glue";
import type { Guid } from "@argon-chat/ion.webcore";
import {
  Loader2, CheckCircle2, XCircle,
  ThumbsDown, ShieldAlert, Swords, Package,
  UserX, FileWarning, Scale, Copyright, MessageSquareWarning, HelpCircle,
} from "lucide-vue-next";

const { t } = useLocale();
const api = useApi();

// ── Props ──

const props = defineProps<{
  targetKind: ReportTargetKind;
  targetId: Guid;
  channelId?: Guid | null;
  messageId?: bigint | null;
}>();

const open = defineModel<boolean>("open", { default: false });

// ── State ──

type Step = "category" | "reason" | "comment" | "submitting" | "success" | "error";
const step = ref<Step>("category");
const selectedCategory = ref<ReportCategory | null>(null);
const selectedReason = ref<ReportReason | null>(null);
const additionalInfo = ref("");
const errorMessage = ref("");

// Reset when dialog opens
watch(open, (v) => {
  if (v) {
    step.value = "category";
    selectedCategory.value = null;
    selectedReason.value = null;
    additionalInfo.value = "";
    errorMessage.value = "";
  }
});

// ── Category → Reason mapping (mirrors backend ValidReasons) ──

const VALID_REASONS: Record<ReportCategory, ReportReason[]> = {
  [ReportCategory.I_DONT_LIKE_IT]: [ReportReason.NONE],
  [ReportCategory.CHILD_ABUSE]: [ReportReason.CHILD_SEXUAL_ABUSE, ReportReason.CHILD_PHYSICAL_ABUSE],
  [ReportCategory.VIOLENCE]: [
    ReportReason.INSULTS_OR_FALSE_INFO, ReportReason.GRAPHIC_OR_DISTURBING_CONTENT,
    ReportReason.EXTREME_VIOLENCE, ReportReason.HATE_SPEECH_OR_SYMBOL,
    ReportReason.CALLING_FOR_VIOLENCE, ReportReason.ORGANIZED_CRIME,
    ReportReason.TERRORISM, ReportReason.ANIMAL_ABUSE,
  ],
  [ReportCategory.ILLEGAL_GOODS]: [
    ReportReason.WEAPONS, ReportReason.DRUGS, ReportReason.FAKE_DOCUMENTS,
    ReportReason.COUNTERFEIT_MONEY, ReportReason.HACKING_TOOLS_AND_MALWARE,
    ReportReason.COUNTERFEIT_MERCHANDISE, ReportReason.OTHER_GOODS_AND_SERVICES,
  ],
  [ReportCategory.ILLEGAL_ADULT_CONTENT]: [
    ReportReason.IAC_CHILD_ABUSE, ReportReason.ILLEGAL_SEXUAL_SERVICES,
    ReportReason.IAC_ANIMAL_ABUSE, ReportReason.NON_CONSENSUAL_SEXUAL_IMAGERY,
    ReportReason.PORNOGRAPHY, ReportReason.IAC_OTHER,
  ],
  [ReportCategory.PERSONAL_DATA]: [
    ReportReason.PRIVATE_IMAGES, ReportReason.PHONE_NUMBER, ReportReason.ADDRESS,
    ReportReason.STOLEN_DATA_OR_CREDENTIALS, ReportReason.PD_OTHER,
  ],
  [ReportCategory.SCAM_OR_FRAUD]: [
    ReportReason.IMPERSONATION, ReportReason.DECEPTIVE_FINANCIAL_CLAIMS,
    ReportReason.SF_MALWARE, ReportReason.PHISHING, ReportReason.FRAUDULENT_SELLER,
  ],
  [ReportCategory.COPYRIGHT]: [ReportReason.NONE],
  [ReportCategory.SPAM]: [
    ReportReason.SPAM_INSULTS_OR_FALSE_INFO, ReportReason.PROMOTING_ILLEGAL_CONTENT,
    ReportReason.SPAM_OTHER,
  ],
  [ReportCategory.OTHER]: [
    ReportReason.OTHER_I_DONT_LIKE_IT, ReportReason.OTHER_FALSE_INFO,
    ReportReason.OTHER_ILLEGAL_ADULT_CONTENT, ReportReason.OTHER_ILLEGAL_GOODS_AND_SERVICES,
    ReportReason.OTHER_ELSE,
  ],
};

// ── Reason → i18n key mapping ──

const REASON_KEYS: Record<ReportReason, string> = {
  [ReportReason.NONE]: "",
  [ReportReason.CHILD_SEXUAL_ABUSE]: "report_reason_child_sexual_abuse",
  [ReportReason.CHILD_PHYSICAL_ABUSE]: "report_reason_child_physical_abuse",
  [ReportReason.INSULTS_OR_FALSE_INFO]: "report_reason_insults_or_false_info",
  [ReportReason.GRAPHIC_OR_DISTURBING_CONTENT]: "report_reason_graphic_or_disturbing_content",
  [ReportReason.EXTREME_VIOLENCE]: "report_reason_extreme_violence",
  [ReportReason.HATE_SPEECH_OR_SYMBOL]: "report_reason_hate_speech_or_symbol",
  [ReportReason.CALLING_FOR_VIOLENCE]: "report_reason_calling_for_violence",
  [ReportReason.ORGANIZED_CRIME]: "report_reason_organized_crime",
  [ReportReason.TERRORISM]: "report_reason_terrorism",
  [ReportReason.ANIMAL_ABUSE]: "report_reason_animal_abuse",
  [ReportReason.WEAPONS]: "report_reason_weapons",
  [ReportReason.DRUGS]: "report_reason_drugs",
  [ReportReason.FAKE_DOCUMENTS]: "report_reason_fake_documents",
  [ReportReason.COUNTERFEIT_MONEY]: "report_reason_counterfeit_money",
  [ReportReason.HACKING_TOOLS_AND_MALWARE]: "report_reason_hacking_tools_and_malware",
  [ReportReason.COUNTERFEIT_MERCHANDISE]: "report_reason_counterfeit_merchandise",
  [ReportReason.OTHER_GOODS_AND_SERVICES]: "report_reason_other_goods_and_services",
  [ReportReason.IAC_CHILD_ABUSE]: "report_reason_iac_child_abuse",
  [ReportReason.ILLEGAL_SEXUAL_SERVICES]: "report_reason_illegal_sexual_services",
  [ReportReason.IAC_ANIMAL_ABUSE]: "report_reason_iac_animal_abuse",
  [ReportReason.NON_CONSENSUAL_SEXUAL_IMAGERY]: "report_reason_non_consensual_sexual_imagery",
  [ReportReason.PORNOGRAPHY]: "report_reason_pornography",
  [ReportReason.IAC_OTHER]: "report_reason_iac_other",
  [ReportReason.PRIVATE_IMAGES]: "report_reason_private_images",
  [ReportReason.PHONE_NUMBER]: "report_reason_phone_number",
  [ReportReason.ADDRESS]: "report_reason_address",
  [ReportReason.STOLEN_DATA_OR_CREDENTIALS]: "report_reason_stolen_data_or_credentials",
  [ReportReason.PD_OTHER]: "report_reason_pd_other",
  [ReportReason.IMPERSONATION]: "report_reason_impersonation",
  [ReportReason.DECEPTIVE_FINANCIAL_CLAIMS]: "report_reason_deceptive_financial_claims",
  [ReportReason.SF_MALWARE]: "report_reason_sf_malware",
  [ReportReason.PHISHING]: "report_reason_phishing",
  [ReportReason.FRAUDULENT_SELLER]: "report_reason_fraudulent_seller",
  [ReportReason.SPAM_INSULTS_OR_FALSE_INFO]: "report_reason_spam_insults_or_false_info",
  [ReportReason.PROMOTING_ILLEGAL_CONTENT]: "report_reason_promoting_illegal_content",
  [ReportReason.SPAM_OTHER]: "report_reason_spam_other",
  [ReportReason.OTHER_I_DONT_LIKE_IT]: "report_reason_other_i_dont_like_it",
  [ReportReason.OTHER_FALSE_INFO]: "report_reason_other_false_info",
  [ReportReason.OTHER_ILLEGAL_ADULT_CONTENT]: "report_reason_other_illegal_adult_content",
  [ReportReason.OTHER_ILLEGAL_GOODS_AND_SERVICES]: "report_reason_other_illegal_goods_and_services",
  [ReportReason.OTHER_ELSE]: "report_reason_other_else",
};

// ── Category list with icons ──

const categoryList = computed(() => [
  { value: ReportCategory.I_DONT_LIKE_IT, label: t("report_category_i_dont_like_it"), icon: ThumbsDown },
  { value: ReportCategory.CHILD_ABUSE, label: t("report_category_child_abuse"), icon: ShieldAlert },
  { value: ReportCategory.VIOLENCE, label: t("report_category_violence"), icon: Swords },
  { value: ReportCategory.ILLEGAL_GOODS, label: t("report_category_illegal_goods"), icon: Package },
  { value: ReportCategory.ILLEGAL_ADULT_CONTENT, label: t("report_category_illegal_adult_content"), icon: UserX },
  { value: ReportCategory.PERSONAL_DATA, label: t("report_category_personal_data"), icon: FileWarning },
  { value: ReportCategory.SCAM_OR_FRAUD, label: t("report_category_scam_or_fraud"), icon: Scale },
  { value: ReportCategory.COPYRIGHT, label: t("report_category_copyright"), icon: Copyright },
  { value: ReportCategory.SPAM, label: t("report_category_spam"), icon: MessageSquareWarning },
  { value: ReportCategory.OTHER, label: t("report_category_other"), icon: HelpCircle },
]);

// ── Reason list (dynamic based on selected category) ──

const reasonList = computed(() => {
  if (selectedCategory.value == null) return [];
  const reasons = VALID_REASONS[selectedCategory.value] ?? [];
  return reasons
    .filter((r) => r !== ReportReason.NONE)
    .map((r) => ({ value: r, label: t(REASON_KEYS[r]) }));
});

// ── Navigation ──

function selectCategory(cat: ReportCategory) {
  selectedCategory.value = cat;
  const reasons = VALID_REASONS[cat];
  // Skip reason step if the only valid reason is NONE
  if (reasons.length === 1 && reasons[0] === ReportReason.NONE) {
    selectedReason.value = ReportReason.NONE;
    step.value = "comment";
  } else {
    step.value = "reason";
  }
}

function selectReason(reason: ReportReason) {
  selectedReason.value = reason;
  step.value = "comment";
}

function goBack() {
  if (step.value === "comment") {
    const reasons = VALID_REASONS[selectedCategory.value!];
    if (reasons.length === 1 && reasons[0] === ReportReason.NONE) {
      step.value = "category";
    } else {
      step.value = "reason";
    }
  } else if (step.value === "reason") {
    step.value = "category";
  }
}

// ── Submit ──

async function submitReport() {
  step.value = "submitting";
  try {
    const target: ReportTarget = {
      kind: props.targetKind,
      targetId: props.targetId,
      channelId: props.channelId ?? null,
      messageId: props.messageId ?? null,
    };
    const input: CreateReportInput = {
      target,
      category: selectedCategory.value!,
      reason: selectedReason.value!,
      additionalInfo: additionalInfo.value.trim() || null,
      referenceReportId: null,
    };
    const result = await api.reportInteraction.SubmitReport(input);
    if (result.isSuccessSubmitReport()) {
      step.value = "success";
    } else if (result.isFailedSubmitReport()) {
      errorMessage.value = getErrorMessage(result.error);
      step.value = "error";
    }
  } catch {
    errorMessage.value = t("report_error_internal");
    step.value = "error";
  }
}

function getErrorMessage(error: SubmitReportError): string {
  switch (error) {
    case SubmitReportError.INVALID_TARGET: return t("report_error_invalid_target");
    case SubmitReportError.CANNOT_REPORT_SELF: return t("report_error_cannot_report_self");
    case SubmitReportError.DUPLICATE_REPORT: return t("report_error_duplicate");
    case SubmitReportError.RATE_LIMITED: return t("report_error_rate_limited");
    case SubmitReportError.TARGET_NOT_FOUND: return t("report_error_not_found");
    default: return t("report_error_internal");
  }
}
</script>
