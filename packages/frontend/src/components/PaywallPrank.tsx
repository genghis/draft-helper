import { useCallback, useEffect, useState } from "react";
import "./Modal.css";
import "./PaywallPrank.css";

/**
 * A gag paywall for one specific league member, fired once round 4 is in the
 * books. It is meant to look like a real billing wall for about four seconds.
 *
 * The card fields deliberately do not work. Two digits total is the most this
 * ever holds — the third one anywhere in the form (or a paste of more than
 * two, or the promo code, or Escape, or the backdrop) drops the act. That
 * cap is the whole point: a joke paywall that actually accepted a card number
 * would be a real card number sitting in React state on someone else's laptop.
 * Nothing typed here is stored, persisted, or sent anywhere — there is no
 * network call in this file, and there should never be one.
 */

interface Props {
  /** Shown on the reveal, so it's unmistakably aimed at him and not a real bill. */
  name: string;
  onDismiss: () => void;
}

const BLANK = { card: "", exp: "", cvc: "" };

/** "Dog Emperor" in any casing, spacing, or punctuation he tries. */
const PROMO_CODE = "dogemperor";
const normalizePromo = (raw: string) => raw.toLowerCase().replace(/[^a-z0-9]/g, "");

export function PaywallPrank({ name, onDismiss }: Props) {
  const [busted, setBusted] = useState(false);
  const [digits, setDigits] = useState(BLANK);
  const [promo, setPromo] = useState("");
  const [promoError, setPromoError] = useState(false);

  const bust = useCallback(() => {
    setDigits(BLANK);
    setBusted(true);
  }, []);

  // Escape gives up the joke rather than dismissing outright — otherwise he
  // taps it on reflex and never sees the reveal.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (busted) onDismiss();
      else bust();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busted, bust, onDismiss]);

  const typed = digits.card.length + digits.exp.length + digits.cvc.length;

  const onDigits = (field: keyof typeof BLANK, raw: string) => {
    const clean = raw.replace(/\D/g, "");
    if (typed + 1 >= 3 || clean.length > 2) {
      bust();
      return;
    }
    setDigits((d) => ({ ...d, [field]: clean.slice(0, 2) }));
  };

  const applyPromo = () => {
    if (normalizePromo(promo) === PROMO_CODE) bust();
    else setPromoError(true);
  };

  return (
    <div className="modal-backdrop" onClick={busted ? onDismiss : bust}>
      <div
        className={busted ? "modal-card paywall-card is-busted" : "modal-card paywall-card"}
        onClick={(e) => e.stopPropagation()}
      >
        {busted ? (
          <div className="paywall-busted">
            <video
              className="paywall-gif"
              src="/antonio-brown-peace-out.mp4"
              autoPlay
              muted
              loop
              playsInline
            />
            <h2>Peace out, {name}.</h2>
            <p>
              You already paid Genghis's dues, so I won't actually collect your payment.
            </p>
            <button type="button" className="paywall-submit" onClick={onDismiss}>
              Fine. Let me draft.
            </button>
          </div>
        ) : (
          <>
            <h2>Your free trial ended</h2>
            <p className="paywall-lede">
              Rounds 1–4 are included with Draft Helper Basic. Add a payment method to keep
              your cheat sheet live for the rest of the draft.
            </p>

            <label className="modal-field">
              <span>Card number</span>
              <input
                type="text"
                inputMode="numeric"
                placeholder="1234 5678 9012 3456"
                name="dh-prank-no-autofill"
                autoComplete="off"
                value={digits.card}
                onChange={(e) => onDigits("card", e.target.value)}
              />
            </label>

            <div className="paywall-row">
              <label className="modal-field">
                <span>Expiry</span>
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="MM / YY"
                  name="dh-prank-no-autofill-2"
                  autoComplete="off"
                  value={digits.exp}
                  onChange={(e) => onDigits("exp", e.target.value)}
                />
              </label>
              <label className="modal-field">
                <span>CVC</span>
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="123"
                  name="dh-prank-no-autofill-3"
                  autoComplete="off"
                  value={digits.cvc}
                  onChange={(e) => onDigits("cvc", e.target.value)}
                />
              </label>
            </div>

            <div className="modal-actions paywall-actions">
              <button type="button" className="paywall-submit" onClick={bust}>
                Continue — $4.99
              </button>
            </div>

            <div className="paywall-promo">
              <label className="modal-field">
                <span>Or enter promo code</span>
                <div className="paywall-promo-row">
                  <input
                    type="text"
                    placeholder="PROMO CODE"
                    name="dh-prank-promo"
                    autoComplete="off"
                    value={promo}
                    onChange={(e) => {
                      setPromo(e.target.value);
                      setPromoError(false);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") applyPromo();
                    }}
                  />
                  <button type="button" className="secondary" onClick={applyPromo}>
                    Apply
                  </button>
                </div>
              </label>
              {promoError && <p className="modal-error">That code isn't valid for this plan.</p>}
            </div>

            <p className="paywall-fine">Billed once. Cancel anytime before your next draft.</p>
          </>
        )}
      </div>
    </div>
  );
}
