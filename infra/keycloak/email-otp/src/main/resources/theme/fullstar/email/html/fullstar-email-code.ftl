<#import "template.ftl" as layout>
<@layout.emailLayout>
<p>${msg("fullstarEmailCodeIntro")}</p>
<p style="font-size:28px;font-weight:700;letter-spacing:6px;">${code}</p>
<p>${msg("fullstarEmailCodeValidity", validMinutes)}</p>
<p>${msg("fullstarEmailCodeIgnore")}</p>
</@layout.emailLayout>
