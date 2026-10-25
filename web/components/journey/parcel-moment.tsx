"use client";

import {
  motion,
  useTransform,
  type MotionValue,
} from "motion/react";

/**
 * Focal parcel on the table: arrives, settles as an open box, then a shirt
 * rises smoothly from the interior (masked by the front wall until clear).
 * Fully reversible via scroll progress. No lid flaps.
 */
export function ParcelMoment({
  scrollYProgress,
  reduced,
}: {
  scrollYProgress: MotionValue<number>;
  reduced: boolean;
}) {
  const t = useTransform(scrollYProgress, [0.42, 1], [0, 1]);

  const boxY = useTransform(
    t,
    [0, 0.16, 0.24, 0.3, 0.36],
    reduced ? [0, 0, 0, 0, 0] : [-160, 10, -4, 2, 0],
  );
  const boxRot = useTransform(t, [0, 0.26], reduced ? [0, 0] : [-5, 0]);
  const boxOpacity = useTransform(t, [0.02, 0.1, 0.92, 1], reduced ? [1, 1, 1, 1] : [0, 1, 1, 0.95]);
  const shadowOpacity = useTransform(t, [0.12, 0.3, 0.9], reduced ? [0.45, 0.45, 0.45] : [0, 0.55, 0.45]);
  const shadowScale = useTransform(t, [0.12, 0.32], reduced ? [1, 1] : [0.55, 1]);

  // Continuous rise — no plateau that reads as hitting a ceiling.
  const shirtY = useTransform(t, [0.38, 0.92], reduced ? [-150, -150] : [72, -150]);
  const shirtScale = useTransform(t, [0.38, 0.92], reduced ? [1, 1] : [0.72, 1]);
  const shirtOpacity = useTransform(t, [0.36, 0.48], reduced ? [1, 1] : [0, 1]);
  // Stay behind the front wall until the body clears the rim, then lift above.
  const shirtZ = useTransform(t, [0.55, 0.68], [2, 6]);
  const captionOpacity = useTransform(t, [0.7, 0.86], [0, 1]);

  return (
    <div className="parcel" data-testid="parcel-moment">
      <motion.div className="parcel__stage" style={{ opacity: boxOpacity }}>
        <motion.div
          className="parcel__shadow"
          style={{ opacity: shadowOpacity, scaleX: shadowScale }}
          aria-hidden
        />

        <motion.div className="parcel__rig" style={{ y: boxY, rotate: boxRot }}>
          <div className="parcel__cavity" aria-hidden>
            <div className="parcel__cavity-floor" />
            <div className="parcel__cavity-back" />
            <div className="parcel__cavity-shade" />
          </div>

          <div className="parcel__wall parcel__wall--left" aria-hidden />
          <div className="parcel__wall parcel__wall--right" aria-hidden />
          <div className="parcel__wall parcel__wall--front">
            <div className="parcel__label" aria-hidden>
              <span>RETURN</span>
              <span>NLA · 88421</span>
            </div>
          </div>

          {/* Open rim strip — reads as an open box, not a hinged lid */}
          <div className="parcel__rim" aria-hidden />

          <motion.div className="parcel__well" style={{ zIndex: shirtZ }} aria-hidden>
            <motion.div
              className="parcel__shirt-wrap"
              style={{ y: shirtY, scale: shirtScale, opacity: shirtOpacity }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                className="parcel__shirt"
                src="/images/parcel-shirt.png"
                alt=""
                draggable={false}
              />
            </motion.div>
          </motion.div>
        </motion.div>
      </motion.div>

      <motion.p className="parcel__caption" style={{ opacity: captionOpacity }}>
        Ordered one thing. Claiming another.
      </motion.p>
    </div>
  );
}
