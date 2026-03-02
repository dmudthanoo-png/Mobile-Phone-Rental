"use client";

import React, { useState } from 'react';

const PACKAGES = [
  { id: 'basic', name: 'Basic', model: 'iPhone 13 Pro Max', price: 800, emoji: '📱', features: ['ซูม 3x', 'วิดีโอ 4K'], popular: false },
  { id: 'pro', name: 'Pro', model: 'iPhone 14 Pro Max', price: 1000, emoji: '📸', features: ['ซูม 3x', 'กันสั่นเทพ', 'วิดีโอ 4K 60fps'], popular: true },
  { id: 'premium', name: 'Premium', model: 'Samsung S24 Ultra', price: 1200, emoji: '🌟', features: ['ซูม 100x', 'ถ่ายคอนเสิร์ตชัดสุด'], popular: false },
];

const MOCK_BOOKINGS: Record<string, Record<string, number>> = {
  '2026-03-05': { basic: 0, pro: 3, premium: 1 },
  '2026-03-06': { basic: 1, pro: 2, premium: 3 },
  '2026-03-07': { basic: 0, pro: 3, premium: 0 },
  '2026-03-10': { basic: 3, pro: 3, premium: 3 },
  '2026-03-14': { basic: 2, pro: 3, premium: 2 },
  '2026-03-20': { basic: 1, pro: 2, premium: 3 },
};

const VENUES = [
  { id: 'impact', name: 'IMPACT เมืองทองธานี', short: 'IMPACT', area: 'นนทบุรี', emoji: '🎪' },
  { id: 'rajamangala', name: 'ราชมังคลากีฬาสถาน', short: 'ราชมังฯ', area: 'กรุงเทพฯ', emoji: '🏟️' },
];

const TOTAL_UNITS = 3;
const DEPOSIT_FEE = 500;
const THAI_MONTHS = ["มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน","กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม"];
const DAYS_OF_WEEK = ['อา','จ','อ','พ','พฤ','ศ','ส'];

const doodle = {
  card: { borderRadius: '18px', border: '2.5px solid #1a1a1a', boxShadow: '4px 4px 0px #1a1a1a', background: '#fff' } as React.CSSProperties,
  cardPink: { borderRadius: '18px', border: '2.5px solid #1a1a1a', boxShadow: '4px 4px 0px #1a1a1a', background: '#FFE8F0' } as React.CSSProperties,
  cardYellow: { borderRadius: '18px', border: '2.5px solid #1a1a1a', boxShadow: '4px 4px 0px #1a1a1a', background: '#FFF9E6' } as React.CSSProperties,
  btn: { borderRadius: '50px', border: '2.5px solid #1a1a1a', boxShadow: '3px 3px 0px #1a1a1a', fontWeight: 800, cursor: 'pointer', transition: 'all .1s' } as React.CSSProperties,
  btnPrimary: { borderRadius: '50px', border: '2.5px solid #1a1a1a', boxShadow: '3px 3px 0px #1a1a1a', fontWeight: 800, cursor: 'pointer', background: '#FF85B3', color: '#1a1a1a' } as React.CSSProperties,
  btnGreen: { borderRadius: '50px', border: '2.5px solid #1a1a1a', boxShadow: '3px 3px 0px #1a1a1a', fontWeight: 800, cursor: 'pointer', background: '#5FD16A', color: '#fff' } as React.CSSProperties,
  btnGray: { borderRadius: '50px', border: '2.5px solid #ccc', boxShadow: '3px 3px 0px #ccc', fontWeight: 800, cursor: 'not-allowed', background: '#eee', color: '#aaa' } as React.CSSProperties,
  pill: { borderRadius: '50px', border: '2px solid #1a1a1a', padding: '2px 10px', fontSize: 11, fontWeight: 700, display: 'inline-block' } as React.CSSProperties,
  input: { borderRadius: '14px', border: '2.5px solid #1a1a1a', padding: '10px 14px', fontSize: 14, outline: 'none', width: '100%', background: '#FFFDF5', fontFamily: 'inherit', boxSizing: 'border-box' } as React.CSSProperties,
};

function WiggleLine() {
  return (
    <svg width="100%" height="8" viewBox="0 0 300 8" preserveAspectRatio="none" style={{ display: 'block', margin: '4px 0' }}>
      <path d="M0,4 Q15,0 30,4 Q45,8 60,4 Q75,0 90,4 Q105,8 120,4 Q135,0 150,4 Q165,8 180,4 Q195,0 210,4 Q225,8 240,4 Q255,0 270,4 Q285,8 300,4"
        fill="none" stroke="#FFB3D1" strokeWidth="2.5"/>
    </svg>
  );
}

export default function PhoneRentalApp() {
  const [step, setStep] = useState(1);
  const [selectedPkg, setSelectedPkg] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedVenue, setSelectedVenue] = useState<string | null>(null);
  const [renterName, setRenterName] = useState('');
  const [renterPhone, setRenterPhone] = useState('');
  const [copiedType, setCopiedType] = useState<string | null>(null);
  const [slipPreview, setSlipPreview] = useState<string | null>(null);
  const [refNumber, setRefNumber] = useState('');

  const today = new Date(2026, 2, 2);
  const daysInMonth = new Date(2026, 3, 0).getDate();
  const firstDayOfMonth = new Date(2026, 2, 1).getDay();

  const formatThaiDate = (dateStr: string) => {
    const [y, m, d] = dateStr.split('-');
    return `${parseInt(d)} ${THAI_MONTHS[parseInt(m) - 1]} ${parseInt(y) + 543}`;
  };

  const getAvailability = (dateStr: string) => {
    const slotsUsed = MOCK_BOOKINGS[dateStr]?.[selectedPkg || 'basic'] || 0;
    if (slotsUsed >= TOTAL_UNITS) return 'red';
    if (slotsUsed === TOTAL_UNITS - 1) return 'amber';
    return 'green';
  };

  const handleCopy = (text: string, type: string) => {
    navigator.clipboard.writeText(text);
    setCopiedType(type);
    setTimeout(() => setCopiedType(null), 2000);
  };

  const handleNext = () => {
    if (step === 4) setRefNumber(`RT-${Math.floor(100000 + Math.random() * 900000)}`);
    setStep(s => Math.min(5, s + 1));
  };
  const handleBack = () => setStep(s => Math.max(1, s - 1));

  const isNextDisabled = () => {
    if (step === 1) return !selectedPkg;
    if (step === 2) return !selectedDate || !selectedVenue;
    if (step === 3) return !renterName.trim() || !renterPhone.trim() || renterPhone.length < 9;
    if (step === 4) return !slipPreview;
    return false;
  };

  const selectedPkgData = PACKAGES.find(p => p.id === selectedPkg);
  const selectedVenueData = VENUES.find(v => v.id === selectedVenue);
  const totalAmount = selectedPkgData ? selectedPkgData.price + DEPOSIT_FEE : 0;
  const stepLabels = ['แพ็กเกจ','วันรับ','ข้อมูล','ชำระเงิน','เสร็จ!'];

  return (
    <div style={{ minHeight: '100vh', background: '#FFF5F9', fontFamily: "'Mitr', 'Kanit', 'Segoe UI', sans-serif", display: 'flex', justifyContent: 'center', paddingBottom: 100 }}>
      <div style={{ width: '100%', maxWidth: 420 }}>

        {/* Header */}
        <div style={{ padding: '24px 20px 12px', position: 'sticky', top: 0, background: '#FFF5F9', zIndex: 10 }}>
          <div style={{ textAlign: 'center', marginBottom: 16 }}>
            <div style={{ fontSize: 28, fontWeight: 900, color: '#1a1a1a' }}>
              <span style={{ color: '#FF85B3' }}>📱</span> เช่ามือถือ
            </div>
            <div style={{ fontSize: 13, color: '#888', fontWeight: 600 }}>ถ่ายคอนเสิร์ตให้ปัง! ✨</div>
            <WiggleLine />
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 8, alignItems: 'center' }}>
            {stepLabels.map((l, i) => (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                <div style={{ width: step === i + 1 ? 32 : 10, height: 10, borderRadius: 10, background: step > i ? '#FF85B3' : '#E0E0E0', border: '2px solid #1a1a1a', transition: 'all .3s' }} />
                <span style={{ fontSize: 9, fontWeight: 700, color: step === i + 1 ? '#FF85B3' : '#bbb' }}>{l}</span>
              </div>
            ))}
          </div>
        </div>

        <div style={{ padding: '8px 20px' }}>

          {/* STEP 1 */}
          {step === 1 && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                <span style={{ fontSize: 20 }}>🎯</span>
                <span style={{ fontWeight: 900, fontSize: 18 }}>เลือกแพ็กเกจ</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {PACKAGES.map(pkg => {
                  const sel = selectedPkg === pkg.id;
                  return (
                    <div key={pkg.id} onClick={() => setSelectedPkg(pkg.id)}
                      style={{ ...(sel ? doodle.cardPink : doodle.card), padding: 16, cursor: 'pointer', position: 'relative', transform: sel ? 'translate(-2px,-2px)' : '', boxShadow: sel ? '6px 6px 0px #1a1a1a' : '4px 4px 0px #1a1a1a', transition: 'all .15s' }}>
                      {pkg.popular && (
                        <div style={{ position: 'absolute', top: -12, right: 16, background: '#FFD600', border: '2.5px solid #1a1a1a', borderRadius: 50, padding: '2px 12px', fontSize: 11, fontWeight: 900 }}>
                          ⭐ ยอดนิยม
                        </div>
                      )}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                          <div style={{ width: 44, height: 44, background: sel ? '#FF85B3' : '#f5f5f5', borderRadius: 12, border: '2.5px solid #1a1a1a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>
                            {pkg.emoji}
                          </div>
                          <div>
                            <div style={{ fontWeight: 900, fontSize: 16 }}>{pkg.name}</div>
                            <div style={{ fontSize: 12, color: '#888', fontWeight: 600 }}>{pkg.model}</div>
                          </div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontWeight: 900, fontSize: 20, color: '#FF85B3' }}>฿{pkg.price}</div>
                          <div style={{ fontSize: 11, color: '#aaa', fontWeight: 600 }}>/ วัน</div>
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {pkg.features.map((f, i) => (
                          <span key={i} style={{ ...doodle.pill, background: sel ? '#fff' : '#FFF5F9', color: '#1a1a1a' }}>{f}</span>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* STEP 2 */}
          {step === 2 && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                <span style={{ fontSize: 20 }}>📅</span>
                <span style={{ fontWeight: 900, fontSize: 18 }}>เลือกวันรับ</span>
              </div>
              <div style={{ ...doodle.card, padding: 16, marginBottom: 14 }}>
                <div style={{ textAlign: 'center', fontWeight: 900, marginBottom: 12, fontSize: 15 }}>{THAI_MONTHS[2]} 2569 🌸</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 2, marginBottom: 8 }}>
                  {DAYS_OF_WEEK.map(d => <div key={d} style={{ textAlign: 'center', fontSize: 11, fontWeight: 700, color: '#999', padding: '4px 0' }}>{d}</div>)}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 3 }}>
                  {Array.from({ length: firstDayOfMonth }).map((_, i) => <div key={`e${i}`} />)}
                  {Array.from({ length: daysInMonth }).map((_, i) => {
                    const dateNum = i + 1;
                    const dateStr = `2026-03-${String(dateNum).padStart(2, '0')}`;
                    const isPast = dateNum < today.getDate();
                    const status = getAvailability(dateStr);
                    const isFull = status === 'red';
                    const disabled = isPast || isFull;
                    const sel = selectedDate === dateStr;
                    const isToday = dateNum === today.getDate();
                    return (
                      <div key={dateNum} onClick={() => !disabled && setSelectedDate(dateStr)}
                        style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '6px 2px', borderRadius: 12, cursor: disabled ? 'not-allowed' : 'pointer', background: sel ? '#FF85B3' : isToday ? '#FFF9E6' : 'transparent', border: sel ? '2.5px solid #1a1a1a' : isToday ? '2px dashed #FFB3D1' : '2px solid transparent', opacity: disabled ? 0.3 : 1, transition: 'all .15s' }}>
                        <span style={{ fontSize: 13, fontWeight: sel ? 900 : 600, color: sel ? '#fff' : '#1a1a1a' }}>{dateNum}</span>
                        {!isPast && <div style={{ width: 6, height: 6, borderRadius: '50%', marginTop: 2, border: '1.5px solid #1a1a1a', background: sel ? '#fff' : status === 'green' ? '#5FD16A' : status === 'amber' ? '#FFD600' : '#FF5A5A' }} />}
                      </div>
                    );
                  })}
                </div>
                <WiggleLine />
                <div style={{ display: 'flex', justifyContent: 'center', gap: 16, marginTop: 4 }}>
                  {[['#5FD16A','ว่าง'],['#FFD600','เหลือน้อย'],['#FF5A5A','เต็ม']].map(([c,l]) => (
                    <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 700 }}>
                      <div style={{ width: 8, height: 8, borderRadius: '50%', background: c, border: '1.5px solid #1a1a1a' }} />{l}
                    </div>
                  ))}
                </div>
              </div>
              {selectedDate && (
                <div style={{ ...doodle.cardYellow, padding: '10px 16px', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 18 }}>🗓️</span>
                  <span style={{ fontWeight: 800, fontSize: 14 }}>วันที่เลือก: {formatThaiDate(selectedDate)}</span>
                </div>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <span style={{ fontSize: 18 }}>📍</span>
                <span style={{ fontWeight: 900, fontSize: 15 }}>สถานที่จัดงาน</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {VENUES.map(v => {
                  const sel = selectedVenue === v.id;
                  return (
                    <div key={v.id} onClick={() => setSelectedVenue(v.id)}
                      style={{ ...(sel ? doodle.cardPink : doodle.card), padding: '14px 10px', cursor: 'pointer', textAlign: 'center', transform: sel ? 'translate(-2px,-2px)' : '', boxShadow: sel ? '6px 6px 0px #1a1a1a' : '4px 4px 0px #1a1a1a', transition: 'all .15s' }}>
                      <div style={{ fontSize: 26, marginBottom: 6 }}>{v.emoji}</div>
                      <div style={{ fontWeight: 900, fontSize: 13, lineHeight: 1.3 }}>{v.short}</div>
                      <div style={{ fontSize: 11, color: '#888', fontWeight: 600, marginTop: 2 }}>{v.area}</div>
                      {sel && <div style={{ marginTop: 6, fontSize: 16 }}>✅</div>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* STEP 3 */}
          {step === 3 && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                <span style={{ fontSize: 20 }}>👤</span>
                <span style={{ fontWeight: 900, fontSize: 18 }}>ข้อมูลผู้เช่า</span>
              </div>
              <div style={{ ...doodle.card, padding: 16, marginBottom: 16 }}>
                <div style={{ marginBottom: 14 }}>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 800, marginBottom: 6 }}>ชื่อ-นามสกุล</label>
                  <input style={doodle.input} type="text" placeholder="ระบุชื่อตามบัตรประชาชน" value={renterName} onChange={e => setRenterName(e.target.value)} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 800, marginBottom: 6 }}>เบอร์โทรศัพท์</label>
                  <input style={doodle.input} type="tel" placeholder="08X-XXX-XXXX" maxLength={10} value={renterPhone} onChange={e => setRenterPhone(e.target.value)} />
                </div>
              </div>
              <div style={{ ...doodle.cardYellow, padding: 16 }}>
                <div style={{ fontWeight: 900, fontSize: 13, color: '#888', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>🧾 สรุปการจอง</div>
                {[
                  ['📱 แพ็กเกจ', `${selectedPkgData?.name} (${selectedPkgData?.model})`],
                  ['🗓️ วันรับ', formatThaiDate(selectedDate!)],
                  ['📍 สถานที่', selectedVenueData?.name || ''],
                  ['💵 ค่าเช่า', `฿${selectedPkgData?.price}`],
                  ['🔒 มัดจำ', `฿${DEPOSIT_FEE}`],
                ].map(([k, v]) => (
                  <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 700, marginBottom: 8, paddingBottom: 8, borderBottom: '1.5px dashed #E0D0B0' }}>
                    <span style={{ color: '#666' }}>{k}</span><span>{v}</span>
                  </div>
                ))}
                <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 900, fontSize: 16, marginTop: 4 }}>
                  <span>💰 รวมทั้งหมด</span>
                  <span style={{ color: '#FF85B3', fontSize: 20 }}>฿{totalAmount}</span>
                </div>
              </div>
            </div>
          )}

          {/* STEP 4 */}
          {step === 4 && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                <span style={{ fontSize: 20 }}>💸</span>
                <span style={{ fontWeight: 900, fontSize: 18 }}>ชำระเงิน</span>
              </div>
              <div style={{ ...doodle.cardPink, padding: '20px 16px', textAlign: 'center', marginBottom: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#888', marginBottom: 4 }}>ยอดที่ต้องโอน</div>
                <div style={{ fontSize: 42, fontWeight: 900, color: '#1a1a1a', lineHeight: 1 }}>฿{totalAmount}</div>
                <div style={{ fontSize: 12, color: '#888', marginTop: 6, fontWeight: 600 }}>รวมมัดจำ ฿{DEPOSIT_FEE} (คืนวันส่งเครื่อง)</div>
              </div>
              <div style={{ ...doodle.card, overflow: 'hidden', marginBottom: 16 }}>
                {[
                  { bg: '#003D6B', label: 'พร้อมเพย์', num: '081-234-5678', name: 'บจก. คอนเสิร์ต เรนทัล', val: '0812345678', key: 'pp' },
                  { bg: '#138F2D', label: 'KBank', num: '123-4-56789-0', name: 'บจก. คอนเสิร์ต เรนทัล', val: '1234567890', key: 'bk' },
                ].map(({ bg, label, num, name, val, key }, i) => (
                  <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderBottom: i === 0 ? '2px dashed #eee' : 'none' }}>
                    <div style={{ width: 42, height: 42, background: bg, borderRadius: 12, border: '2px solid #1a1a1a', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 10, fontWeight: 900, textAlign: 'center', lineHeight: 1.2, flexShrink: 0 }}>{label}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 800, fontSize: 14 }}>{num}</div>
                      <div style={{ fontSize: 11, color: '#888', fontWeight: 600 }}>{name}</div>
                    </div>
                    <button onClick={() => handleCopy(val, key)}
                      style={{ ...doodle.btn, padding: '6px 12px', fontSize: 11, background: copiedType === key ? '#5FD16A' : '#FFF5F9', color: '#1a1a1a', border: '2px solid #1a1a1a', flexShrink: 0 }}>
                      {copiedType === key ? '✓ แล้ว!' : 'คัดลอก'}
                    </button>
                  </div>
                ))}
              </div>
              <label style={{ cursor: 'pointer', display: 'block' }}>
                <div style={{ border: '2.5px dashed #1a1a1a', borderRadius: 18, padding: 20, textAlign: 'center', background: slipPreview ? '#F0FFF4' : '#FFFDF5', transition: 'all .2s' }}>
                  {slipPreview ? (
                    <div>
                      <img src={slipPreview} alt="slip" style={{ maxHeight: 140, borderRadius: 12, objectFit: 'contain', margin: '0 auto', display: 'block', border: '2.5px solid #1a1a1a' }} />
                      <p style={{ marginTop: 8, fontSize: 12, fontWeight: 700, color: '#5FD16A' }}>✅ แนบสลิปแล้ว! แตะเพื่อเปลี่ยน</p>
                    </div>
                  ) : (
                    <div>
                      <div style={{ fontSize: 36, marginBottom: 6 }}>📎</div>
                      <p style={{ fontSize: 14, fontWeight: 800, color: '#1a1a1a', margin: 0 }}>แนบสลิปโอนเงิน</p>
                      <p style={{ fontSize: 11, color: '#aaa', margin: '4px 0 0', fontWeight: 600 }}>JPG, PNG</p>
                    </div>
                  )}
                </div>
                <input type="file" accept="image/*" style={{ display: 'none' }} onChange={e => {
                  const f = e.target.files?.[0];
                  if (f) setSlipPreview(URL.createObjectURL(f));
                }} />
              </label>
            </div>
          )}

          {/* STEP 5 */}
          {step === 5 && (
            <div style={{ textAlign: 'center', paddingTop: 16 }}>
              <div style={{ fontSize: 64, marginBottom: 8 }}>🎉</div>
              <div style={{ fontWeight: 900, fontSize: 24, marginBottom: 4 }}>รอการยืนยัน!</div>
              <div style={{ fontSize: 32, marginBottom: 4 }}>⏳</div>
              <p style={{ fontSize: 13, color: '#888', fontWeight: 600, marginBottom: 20, lineHeight: 1.6 }}>เราได้รับข้อมูลแล้ว~<br/>กรุณาแอดไลน์เพื่อรับการยืนยัน ✨</p>
              <div style={{ ...doodle.cardYellow, padding: 16, marginBottom: 16, textAlign: 'left' }}>
                <div style={{ textAlign: 'center', marginBottom: 12, paddingBottom: 12, borderBottom: '2px dashed #E0D0B0' }}>
                  <div style={{ fontSize: 12, color: '#888', fontWeight: 700 }}>หมายเลขการจอง</div>
                  <div style={{ fontSize: 20, fontWeight: 900, color: '#FF85B3', letterSpacing: 2, marginTop: 4 }}>{refNumber}</div>
                </div>
                {[
                  ['👤 ชื่อ', renterName],
                  ['📱 แพ็กเกจ', selectedPkgData?.name || ''],
                  ['📍 สถานที่', selectedVenueData?.short || ''],
                  ['🗓️ วันรับ', selectedDate ? formatThaiDate(selectedDate) : ''],
                  ['💰 ยอดชำระ', `฿${totalAmount}`],
                ].map(([k, v]) => (
                  <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 700, marginBottom: 8 }}>
                    <span style={{ color: '#888' }}>{k}</span><span>{v}</span>
                  </div>
                ))}
              </div>
              <a href="https://line.me/R/ti/p/@your_oa_id" style={{ textDecoration: 'none' }}>
                <div style={{ ...doodle.btnGreen, padding: '14px 0', fontSize: 15, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, width: '100%' }}>
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="white">
                    <path d="M24 10.304c0-5.369-5.383-9.738-12-9.738-6.616 0-12 4.369-12 9.738 0 4.814 4.269 8.846 10.036 9.608.391.084.922.258 1.057.592.114.281.072.717.035.922-.047.251-.301 1.488-.363 1.831-.107.575-.515 2.059 1.802 1.082 2.316-.976 12.433-7.311 12.433-14.035z"/>
                  </svg>
                  เพิ่มเพื่อน LINE OA
                </div>
              </a>
            </div>
          )}
        </div>

        {/* Bottom Nav */}
        {step < 5 && (
          <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, display: 'flex', justifyContent: 'center', padding: '12px 20px 20px', background: 'linear-gradient(to top, #FFF5F9 60%, transparent)' }}>
            <div style={{ width: '100%', maxWidth: 420, display: 'flex', gap: 12 }}>
              {step > 1 && (
                <button onClick={handleBack} style={{ ...doodle.btn, flex: '0 0 90px', padding: '13px 0', background: '#fff', color: '#1a1a1a', fontSize: 14 }}>
                  ← กลับ
                </button>
              )}
              <button onClick={handleNext} disabled={isNextDisabled()}
                style={{ ...(isNextDisabled() ? doodle.btnGray : step === 4 ? doodle.btnGreen : doodle.btnPrimary), flex: 1, padding: '13px 0', fontSize: 15 }}>
                {step === 4 ? '✓ ฉันโอนแล้ว!' : 'ต่อไป →'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}