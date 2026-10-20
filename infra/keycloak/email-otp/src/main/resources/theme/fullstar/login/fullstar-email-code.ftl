<#import "template.ftl" as layout>
<#import "field.ftl" as field>
<#import "buttons.ftl" as buttons>
<@layout.registrationLayout displayMessage=true; section>
<!-- template: fullstar-email-code.ftl -->
    <#if section="header">
        ${msg("fullstarCodeTitle")}
    <#elseif section="form">
        <form id="kc-fullstar-code-form" class="${properties.kcFormClass!}" onsubmit="login.disabled = true; return true;" action="${url.loginAction}" method="post">
            <@field.input name="code" label=msg("fullstarCodeLabel", codeLength) autocomplete="one-time-code" autofocus=true />
            <@buttons.loginButton />
        </form>
        <form id="kc-fullstar-resend-form" action="${url.loginAction}" method="post">
            <@buttons.actionGroup>
                <@buttons.button id="kc-resend" name="resend" label="fullstarResend" type="secondary" />
                <@buttons.button id="kc-restart" name="restart" label="fullstarOtherEmail" type="link" />
            </@buttons.actionGroup>
        </form>
    </#if>
</@layout.registrationLayout>
