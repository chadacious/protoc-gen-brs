sub Main()
    print "protoc-gen-brs test harness starting..."

    handlers = __pb_getMessageHandlers()
    baseline = GetBaselineData()

    if baseline = invalid then
        print "No baseline data found. Generate fixtures first."
        return
    end if

    cases = baseline.cases
    if cases = invalid or cases.Count() = 0 then
        print "No test cases available."
        return
    end if

    total = cases.Count()
    passed = 0

    for each testCase in cases
        typeName = testCase.type
        print "Verifying type: "; typeName

        if handlers = invalid or handlers.DoesExist(typeName) = false then
            print "  Missing handler for type."; typeName
        else
            handler = handlers[typeName]
            expectedEncoded = testCase.encodedBase64
            expectedValue = testCase.decoded[testCase.field]

        actualEncoded = handler.encode(testCase.decoded)
        decodedResult = handler.decode(expectedEncoded)

        print "    baseline encode: " + expectedEncoded
        print "    runtime encode:  " + actualEncoded

        decodedValue = invalid
        if decodedResult <> invalid then
            if GetInterface(decodedResult, "ifAssociativeArray") <> invalid then
                decodedValue = decodedResult.Lookup(testCase.field)
                else
                    decodedValue = decodedResult[testCase.field]
                end if
            end if

        print "    baseline value:  "; expectedValue
        print "    runtime value:   "; decodedValue

        encodeMatch = actualEncoded = expectedEncoded
        decodeMatch = decodedValue = expectedValue

            if encodeMatch and decodeMatch then
                print "  OK"
                passed = passed + 1
            else
                print "  FAIL"
                print "    expected encode: "; expectedEncoded
                print "    actual encode:   "; actualEncoded
                print "    expected value:  "; expectedValue
                print "    actual value:    "; decodedValue
            end if
        end if
    end for

    print "Summary: "; passed; " of "; total; " cases passed."
end sub
