# Safety reference notes

Reviewed on **27 October 2026**. These sources provide context for routing a concerning reading to a human. They do not validate the prototype's point weights, alert categories, synthetic trajectories, or suitability for any individual. The app is not a diagnostic or treatment tool. A clinician must set individual thresholds and operational escalation procedures before use with real health records.

| Topic | What the primary source says | Application boundary |
| --- | --- | --- |
| Oxygen saturation | WHO's COVID-19 homecare material describes oxygen below 90% as requiring emergency help and 90-94% as possible deterioration. | This is disease-specific guidance. It is not a general monitoring protocol for every senior. The prototype asks a coordinator to verify a reading and arrange review. [WHO homecare material](https://www.who.int/docs/default-source/coronaviruse/risk-comms-updates/update61_covid-19-homecare.pdf). |
| Home oximetry context | NHS England's COVID Oximetry @home pathway treats readings at or below 92% as urgent and 93-94% as requiring clinical contact. | Different sources and patient contexts use different action boundaries. The prototype's illustrative cutoffs require clinical review; do not treat a score below high priority as reassurance. [NHS England pathway](https://www.england.nhs.uk/coronavirus/documents/covid-19-standard-operating-procedure-covid-oximetry-home/). |
| Blood pressure | CDC lists severe readings higher than 180 systolic and/or higher than 120 diastolic. Symptoms affect emergency routing. | The prototype flags severe values for repeat verification and human assessment. It does not establish a condition from one reading or prescribe a drug change. [CDC blood pressure information](https://www.cdc.gov/high-blood-pressure/about/). |
| Low glucose | CDC considers blood sugar below 70 mg/dL low and advises prompt action. | A coordinator prompt must not substitute for an individual care plan. The prototype does not give carbohydrate, insulin, or medication instructions. [CDC low blood sugar information](https://www.cdc.gov/diabetes/treatment/treatment-low-blood-sugar-hypoglycemia.html). |
| High glucose | CDC's DKA page identifies glucose that stays at 300 mg/dL or above among reasons for emergency assessment. DKA also involves symptoms and ketones. | A single reading is not a diagnosis. The prototype routes a severe value for verification and clinical assessment; it does not infer DKA or any other condition. [CDC DKA information](https://www.cdc.gov/diabetes/about/diabetic-ketoacidosis.html). |

## Measurement and workflow limits

Pulse oximetry can be affected by device placement, poor circulation, and skin pigmentation; clinical context matters. Notes can be incomplete or misinterpreted. Missing data does not establish wellbeing. A basic-phone simulator does not guarantee that a call was delivered or that a person received help.

The application deliberately uses fictional people and generated observations. Hosted identity, assigned memberships and consent checks are implemented; representative validation, clinical review, privacy governance, a connected telephone workflow if required, and monitored response procedures remain prerequisites for real-world operation.

## Optional dictation

The implemented dictation requires browser support for `processLocally` and sets it to `true` before recognition. If on-device recognition or its language pack is unavailable, the app retains typed input and does not fall back to a remote recognition service. Read-aloud selects installed voices marked as local. Browser and language support vary; use fictional demo content only. See [MDN Web Speech API documentation](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API/Using_the_Web_Speech_API).

Browser voice calls are distinct from dictation: real WebRTC audio goes to the other authorized browser peer, with explicit microphone permission. It is not recorded or transcribed by the app and does not contact a model. Calls require compatible network paths; the showcase configures no STUN or TURN service.
